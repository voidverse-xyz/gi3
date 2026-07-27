export function getMonitorWorkArea(workspace, monitorIndex) {
    let rect = workspace.get_work_area_for_monitor(monitorIndex);

    return _createSize(rect.x, rect.y, rect.width, rect.height);
}

function _createSize(x, y, width, height) {
    return {
        x: x,
        y: y,
        width: width,
        height: height,
    }
}
