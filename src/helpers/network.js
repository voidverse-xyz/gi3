// Pure /proc/net/dev parsing and rate calculation for the system-monitor indicator.
// Keeping this free of GJS imports makes counter resets and interface churn testable.

const NETWORK_RATE_FORMATS = [
    { threshold: 10_000, divisor: 1_000, unit: 'kB', fractionDigits: 1 },
    { threshold: 1_000_000, divisor: 1_000, unit: 'kB', fractionDigits: 0 },
    { threshold: 10_000_000, divisor: 1_000_000, unit: 'MB', fractionDigits: 1 },
    { threshold: 1_000_000_000, divisor: 1_000_000, unit: 'MB', fractionDigits: 0 },
    { threshold: 10_000_000_000, divisor: 1_000_000_000, unit: 'GB', fractionDigits: 1 },
    { threshold: 1_000_000_000_000, divisor: 1_000_000_000, unit: 'GB', fractionDigits: 0 },
    { threshold: Infinity, divisor: 1_000_000_000_000, unit: 'TB', fractionDigits: 1 },
];

const ZERO_RATES = Object.freeze({ upload: 0, download: 0 });

/**
 * Read byte counters for every non-loopback interface in /proc/net/dev.
 *
 * @param {string|null} contents
 * @param {(interfaceName: string) => boolean} [isLoopback]
 * @returns {{interfaces: Array<{name: string, receivedBytes: number, transmittedBytes: number}>}|null}
 */
export function parseNetworkCounters(contents, isLoopback = (interfaceName) => interfaceName === 'lo') {
    if (typeof contents !== 'string') {
        return null;
    }

    let sawInterface = false;
    let interfaces = [];

    for (const line of contents.split('\n')) {
        const separator = line.indexOf(':');
        if (separator < 0) {
            continue;
        }

        const interfaceName = line.slice(0, separator).trim();
        const fields = line.slice(separator + 1).trim().split(/\s+/).map(Number);
        if (!interfaceName || fields.length < 16 || fields.some((field) => !Number.isFinite(field))) {
            continue;
        }

        sawInterface = true;
        if (isLoopback(interfaceName)) {
            continue;
        }

        interfaces.push({
            name: interfaceName,
            receivedBytes: fields[0],
            transmittedBytes: fields[8],
        });
    }

    if (!sawInterface) {
        return null;
    }

    interfaces.sort((a, b) => a.name.localeCompare(b.name));
    return { interfaces };
}

/**
 * Calculate per-second transfer rates when the sampled interface set and counters are stable.
 * Interface changes and counter resets intentionally produce zero for one sample instead of a spike.
 *
 * @param {{interfaces: Array<{name: string, receivedBytes: number, transmittedBytes: number}>}|null} previous
 * @param {{interfaces: Array<{name: string, receivedBytes: number, transmittedBytes: number}>}|null} current
 * @param {number} elapsedSeconds
 * @returns {{upload: number, download: number}}
 */
export function calculateNetworkRates(previous, current, elapsedSeconds) {
    if (!previous || !current || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
        return ZERO_RATES;
    }
    if (previous.interfaces.length !== current.interfaces.length) {
        return ZERO_RATES;
    }

    let uploadedBytes = 0;
    let downloadedBytes = 0;
    for (let index = 0; index < current.interfaces.length; index++) {
        const previousInterface = previous.interfaces[index];
        const currentInterface = current.interfaces[index];
        if (previousInterface.name !== currentInterface.name) {
            return ZERO_RATES;
        }
        if (currentInterface.receivedBytes < previousInterface.receivedBytes ||
            currentInterface.transmittedBytes < previousInterface.transmittedBytes) {
            return ZERO_RATES;
        }

        uploadedBytes += currentInterface.transmittedBytes - previousInterface.transmittedBytes;
        downloadedBytes += currentInterface.receivedBytes - previousInterface.receivedBytes;
    }

    return {
        upload: uploadedBytes / elapsedSeconds,
        download: downloadedBytes / elapsedSeconds,
    };
}

/**
 * Format bytes per second using the compact decimal units from GNOME's system-monitor extension.
 *
 * @param {number} bytesPerSecond
 * @param {string|string[]} [locales]
 * @returns {string}
 */
export function formatNetworkRate(bytesPerSecond, locales = undefined) {
    const rate = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? bytesPerSecond : 0;
    const format = NETWORK_RATE_FORMATS.find(({ threshold }) => rate < threshold);
    const formatter = new Intl.NumberFormat(locales, {
        minimumFractionDigits: format.fractionDigits,
        maximumFractionDigits: format.fractionDigits,
    });

    return `${formatter.format(rate / format.divisor)} ${format.unit}/s`;
}
