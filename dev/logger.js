import GLib from 'gi://GLib';

var logFileContent = "";

export function LogError(error) {
    let log = JSON.stringify({ message: error.toString(), stack: error.stack, error: error });

    logFileContent += log + "\n"

    let homeDir = GLib.get_home_dir();
    let filePath = GLib.build_filenamev([homeDir, 'gi3.log']);

    try {
        GLib.file_set_contents(filePath, logFileContent);
    } catch { }
}

export function LogLine(...lines) {
    for (let line of lines) {
        logFileContent += line + "\n"
    }

    let homeDir = GLib.get_home_dir();
    let filePath = GLib.build_filenamev([homeDir, 'gi3.log']);

    try {
        GLib.file_set_contents(filePath, logFileContent);
    } catch { }
}