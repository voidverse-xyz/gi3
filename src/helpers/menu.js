import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MENU_SCROLL_HEIGHT_RATIO = 0.5;

/** Size a menu's scrolling content against the primary monitor's available work area. */
export function updateMenuScrollHeight(scrollView) {
    let monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) {
        return;
    }

    let height = monitor.height;
    let monitorIndex = Main.layoutManager.monitors.indexOf(monitor);
    let workspace = global.workspace_manager.get_active_workspace();
    if (workspace && monitorIndex >= 0) {
        height = workspace.get_work_area_for_monitor(monitorIndex).height;
    }

    scrollView.set_style(`max-height: ${Math.floor(height * MENU_SCROLL_HEIGHT_RATIO)}px;`);
}
