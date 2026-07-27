import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { updateMenuScrollHeight } from '../helpers/menu.js';
import { calculateNetworkRates, formatNetworkRate, parseNetworkCounters } from '../helpers/network.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// System stats indicators, modelled on GNOME's own system-monitor extension but without
// the libgtop dependency: CPU, memory, and network counters come from /proc, temperatures
// from /sys/class/hwmon, and NVIDIA GPU utilization from nvidia-smi when the tool exists.

const POLL_SECONDS = 2;
/** Load fraction at/above which a stat is tinted as hot (matches gnome system-monitor). */
const LOAD_HIGH = 0.8;
/** °C at/above which the temperature indicator is tinted as hot. */
const TEMP_HIGH = 80;
/** Sanity window for hwmon readings (some chips report junk like -273 or 65261). */
const TEMP_SANE_MIN = -40;
const TEMP_SANE_MAX = 150;
/** Linux IFF_LOOPBACK; /sys flags let renamed loopback devices stay out of transfer rates. */
const LOOPBACK_INTERFACE_FLAG = 0x8;

const CPU_LABEL = 'CPU';
const MEMORY_LABEL = 'MEM';
const GPU_LABEL = 'GPU';

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

function isLoopbackInterface(interfaceName) {
    let flags = Number.parseInt(readFile(`/sys/class/net/${interfaceName}/flags`), 16);
    if (Number.isFinite(flags)) {
        return (flags & LOOPBACK_INTERFACE_FLAG) !== 0;
    }
    return interfaceName === 'lo';
}

/** One tiny label + "42%" section of the system-monitor indicator. */
class StatSection extends St.BoxLayout {
    static {
        GObject.registerClass(this);
    }

    constructor(label) {
        super({ style_class: 'gi3-sysmon-section', y_align: Clutter.ActorAlign.CENTER });

        this._label = new St.Label({
            text: label,
            style_class: 'gi3-sysmon-metric',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._value = new St.Label({
            style_class: 'gi3-sysmon-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._value);
    }

    setValue(value) {
        this._value.text = value;
    }

    /** @param {number} load 0..1 */
    setLoad(load) {
        this.setValue(`${Math.round(load * 100)}%`);
        if (load >= LOAD_HIGH) {
            this._value.add_style_class_name('gi3-high');
        } else {
            this._value.remove_style_class_name('gi3-high');
        }
    }
}

/** Top-bar CPU / memory / (NVIDIA) GPU usage indicator. */
export const SysMonIndicator = GObject.registerClass(
    class SysMonIndicator extends PanelMenu.Button {
        _timeoutId = null;
        _prevCpu = null;
        _prevNetwork = null;
        _prevNetworkTime = null;
        _gpuQueryRunning = false;
        _gpuFailures = 0;

        constructor(position) {
            super(0.0, 'System Monitor', true /* no menu */);

            let box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
            this._upload = new StatSection('↑');
            this._download = new StatSection('↓');
            this._cpu = new StatSection(CPU_LABEL);
            this._mem = new StatSection(MEMORY_LABEL);
            this._gpu = new StatSection(GPU_LABEL);
            // Network is first so it occupies the far-left edge of the panel's right box.
            box.add_child(this._upload);
            box.add_child(this._download);
            box.add_child(this._cpu);
            box.add_child(this._mem);
            // GPU only when nvidia-smi is available; hidden again after repeated failures.
            this._gpu.visible = GLib.find_program_in_path('nvidia-smi') !== null;
            box.add_child(this._gpu);
            this.add_child(box);

            Main.panel.addToStatusArea('gi3-sysmon', this, position, 'right');

            this._update();
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
            this.connect('destroy', () => {
                if (this._timeoutId) {
                    GLib.source_remove(this._timeoutId);
                    this._timeoutId = null;
                }
            });
        }

        _update() {
            this._updateNetwork();
            this._updateCpu();
            this._updateMem();
            if (this._gpu.visible) {
                this._updateGpu();
            }
        }

        _updateNetwork() {
            let counters = parseNetworkCounters(readFile('/proc/net/dev'), isLoopbackInterface);
            let now = GLib.get_monotonic_time();
            let elapsed = this._prevNetworkTime === null
                ? 0
                : (now - this._prevNetworkTime) / GLib.USEC_PER_SEC;
            let rates = calculateNetworkRates(this._prevNetwork, counters, elapsed);

            this._upload.setValue(formatNetworkRate(rates.upload));
            this._download.setValue(formatNetworkRate(rates.download));
            this._prevNetwork = counters;
            this._prevNetworkTime = counters ? now : null;
        }

        _updateCpu() {
            // First /proc/stat line: cpu user nice system idle iowait irq softirq steal ...
            let line = readFile('/proc/stat')?.split('\n')[0];
            let fields = line?.split(/\s+/).slice(1).map(Number);
            if (!fields || fields.length < 8 || fields.some(isNaN)) {
                return;
            }
            let [user, nice, system, idle, iowait, irq, softirq, steal] = fields;
            let busy = user + nice + system + irq + softirq + steal;
            let total = busy + idle + iowait;

            if (this._prevCpu) {
                let dTotal = total - this._prevCpu.total;
                let dBusy = busy - this._prevCpu.busy;
                if (dTotal > 0) {
                    this._cpu.setLoad(dBusy / dTotal);
                }
            }
            this._prevCpu = { busy, total };
        }

        _updateMem() {
            let info = readFile('/proc/meminfo');
            let total = Number(info?.match(/^MemTotal:\s+(\d+)/m)?.[1]);
            let available = Number(info?.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
            if (!total || isNaN(available)) {
                return;
            }
            this._mem.setLoad(1 - available / total);
        }

        _updateGpu() {
            if (this._gpuQueryRunning) {
                return; // don't stack subprocesses if nvidia-smi is slow
            }
            this._gpuQueryRunning = true;
            try {
                let proc = Gio.Subprocess.new(
                    ['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                proc.communicate_utf8_async(null, null, (p, res) => {
                    this._gpuQueryRunning = false;
                    try {
                        let [, stdout] = p.communicate_utf8_finish(res);
                        // Multi-GPU: average the reported utilizations.
                        let values = stdout.trim().split('\n').map(Number).filter((n) => !isNaN(n));
                        if (p.get_successful() && values.length > 0) {
                            this._gpuFailures = 0;
                            this._gpu.setLoad(values.reduce((a, b) => a + b, 0) / values.length / 100);
                            return;
                        }
                        this._onGpuFailure();
                    } catch {
                        this._onGpuFailure();
                    }
                });
            } catch {
                this._gpuQueryRunning = false;
                this._onGpuFailure();
            }
        }

        _onGpuFailure() {
            // A dead nvidia-smi (driver unloaded, container, ...) shouldn't leave a stale
            // number in the bar or keep spawning subprocesses forever.
            if (++this._gpuFailures >= 3) {
                this._gpu.visible = false;
            }
        }
    }
);

/** @returns {Array<{id: string, name: string, temp: number}>} all plausible hwmon temperatures */
function readSensors() {
    let sensors = [];
    let base = '/sys/class/hwmon';
    let dir;
    try {
        dir = GLib.Dir.open(base, 0);
    } catch {
        return sensors;
    }
    let entry;
    while ((entry = dir.read_name()) !== null) {
        let chipDir = `${base}/${entry}`;
        let chip = readFile(`${chipDir}/name`) ?? entry;
        let files;
        try {
            let d = GLib.Dir.open(chipDir, 0);
            files = [];
            let f;
            while ((f = d.read_name()) !== null) {
                files.push(f);
            }
            d.close();
        } catch {
            continue;
        }
        for (let file of files) {
            let m = file.match(/^temp(\d+)_input$/);
            if (!m) {
                continue;
            }
            let raw = Number(readFile(`${chipDir}/${file}`));
            if (isNaN(raw)) {
                continue;
            }
            let temp = raw / 1000;
            if (temp < TEMP_SANE_MIN || temp > TEMP_SANE_MAX) {
                continue;
            }
            let label = readFile(`${chipDir}/temp${m[1]}_label`);
            sensors.push({
                id: `${entry}/temp${m[1]}`,
                name: label ? `${chip} · ${label}` : `${chip} · temp${m[1]}`,
                temp,
            });
        }
    }
    dir.close();
    return sensors;
}

/** Top-bar temperature indicator: hottest sensor in the bar, every sensor in the menu. */
export const TempsIndicator = GObject.registerClass(
    class TempsIndicator extends PanelMenu.Button {
        _timeoutId = null;
        _workareasSignal = null;

        constructor(position) {
            // Point the menu arrow at the center of the label, matching the clipboard
            // indicator, so the popup opens directly beneath its panel button.
            super(0.5, 'Temperatures', false);

            this._label = new St.Label({
                style_class: 'gi3-sysmon-value',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._label);

            this._section = new PopupMenu.PopupMenuSection();
            this._scroll = new St.ScrollView({ x_expand: true });
            this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
            if (this._scroll.set_child) {
                this._scroll.set_child(this._section.actor);
            } else {
                this._scroll.add_actor(this._section.actor);
            }
            updateMenuScrollHeight(this._scroll);
            this.menu.box.add_child(this._scroll);

            this.menu.connect('open-state-changed', (_menu, open) => {
                if (open) {
                    updateMenuScrollHeight(this._scroll);
                }
            });
            this._workareasSignal = global.display.connect('workareas-changed', () => {
                if (this.menu.isOpen) {
                    updateMenuScrollHeight(this._scroll);
                }
            });

            /** @type {Map<string, St.Label>} sensor id -> its value label in the menu */
            this._rows = new Map();

            Main.panel.addToStatusArea('gi3-temps', this, position, 'right');

            this._update();
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
            this.connect('destroy', () => {
                if (this._timeoutId) {
                    GLib.source_remove(this._timeoutId);
                    this._timeoutId = null;
                }
                if (this._workareasSignal) {
                    global.display.disconnect(this._workareasSignal);
                    this._workareasSignal = null;
                }
            });
        }

        _update() {
            let sensors = readSensors();
            if (sensors.length === 0) {
                // No hwmon (VM, container): keep the indicator out of the bar entirely.
                this.visible = false;
                return;
            }
            this.visible = true;

            let hottest = sensors.reduce((a, b) => (b.temp > a.temp ? b : a));
            this._label.text = `${Math.round(hottest.temp)}°C`;
            if (hottest.temp >= TEMP_HIGH) {
                this._label.add_style_class_name('gi3-high');
            } else {
                this._label.remove_style_class_name('gi3-high');
            }
            this.set_accessible_name(`Temperatures (hottest ${Math.round(hottest.temp)}°C, ${hottest.name})`);

            // NB: the menu must be populated at all times — PopupMenu.open() refuses to
            // open an empty menu, so building rows lazily on open would deadlock it shut.
            this._syncMenu(sensors);
        }

        _syncMenu(sensors) {
            // Show the hottest sensors first; names and ids keep equal readings deterministic.
            let sorted = [...sensors].sort(
                (a, b) => b.temp - a.temp || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
            );

            // Rebuild the row actors only when the sensor set or temperature order changes...
            let key = sorted.map((s) => s.id).join('\n');
            if (key !== this._rowsKey) {
                this._rowsKey = key;
                this._section.removeAll();
                this._rows.clear();
                for (let sensor of sorted) {
                    let item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                    let name = new St.Label({ text: sensor.name, x_expand: true });
                    let value = new St.Label({ style_class: 'gi3-sysmon-value' });
                    item.add_child(name);
                    item.add_child(value);
                    this._section.addMenuItem(item);
                    this._rows.set(sensor.id, value);
                }
            }

            // ...and refresh the cheap value labels in place on every poll.
            for (let sensor of sorted) {
                let value = this._rows.get(sensor.id);
                if (!value) {
                    continue;
                }
                value.text = `${sensor.temp.toFixed(1)}°C`;
                if (sensor.temp >= TEMP_HIGH) {
                    value.add_style_class_name('gi3-high');
                } else {
                    value.remove_style_class_name('gi3-high');
                }
            }
        }
    }
);
