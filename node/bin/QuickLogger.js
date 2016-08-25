/**
 * "Quick" and simple logging function. Logs messages to a log file.
 * Created on 8/24/16.
 */

const fs = require('fs');

var defaultLogFileName = 'arcgis-proxy.txt';
var logFileName;
var logToConsole;
var logLevel;


// LOGLEVELs control what type of logging will appear in the log file and on the console.
module.exports.LOGLEVEL = {
    ALL:   {label: "ALL",   value: 9, key: "A"},
    INFO:  {label: "INFO",  value: 5, key: "I"},
    WARN:  {label: "WARN",  value: 4, key: "W"},
    ERROR: {label: "ERROR", value: 3, key: "E"},
    NONE:  {label: "NONE",  value: 0, key: "X"}
};

/**
 * Check the configuration and verify access to the log file. The configuration object should have the following
 * attributes, any of which are optional and when not found a suitable default is used:
 * {
 *    logLevel: "ALL",
 *    logToConsole: true,
 *    logFilePath: "./",
 *    logFileName: "file-name.txt",
 * }
 * @param configuration {object} see above.
 * @returns {boolean} true if a valid configuration is consumed, false if something is invalid and we cannot function.
 */
module.exports.setConfiguration = function(configuration) {
    var logFilepath,
        isValid = false;

    logToConsole = configuration.logConsole !== undefined ? configuration.logConsole == true : false;
    logLevel = configuration.logLevel !== undefined ? configuration.logLevel : this.LOGLEVEL.NONE.value;
    if (configuration.logFilePath != null || configuration.logFileName != null) {
        if (configuration.logFilePath == null) {
            logFilePath = './';
        } else if (configuration.logFilePath.charAt(configuration.logFilePath.length - 1) != '/') {
            logFilePath = configuration.logFilePath + '/';
        } else {
            logFilePath = configuration.logFilePath;
        }
        if (configuration.logFileName != null) {
            if (configuration.logFileName.charAt(0) == '/') {
                logFileName = logFilePath + configuration.logFileName.substr(1);
            } else {
                logFileName = logFilePath + configuration.logFileName;
            }
        } else {
            logFileName = logFilePath + defaultLogFileName;
        }
    } else {
        logFileName = './' + defaultLogFileName;
    }
    if (logFileName != null) {
        try {
            fs.accessSync(logFilePath, fs.constants.R_OK | fs.constants.W_OK);
            isValid = true;
        } catch (error) {
            this.logEventImmediately(this.LOGLEVEL.ERROR.value, 'No write access to log file ' + logFilePath + ": " + error.toString());
            logFileName = null;
            isValid = false;
        }
    }
    return isValid;
};

/**
 * Helper function to log an INFO level event.
 * @param message
 */
module.exports.logInfoEvent = function(message) {
    this.logEvent(this.LOGLEVEL.INFO.value, message);
};

/**
 * Helper function to log an WARN level event.
 * @param message
 */
module.exports.logWarnEvent = function(message) {
    this.logEvent(this.LOGLEVEL.WARN.value, message);
};

/**
 * Helper function to log an ERROR level event.
 * @param message
 */
module.exports.logErrorEvent = function(message) {
    this.logEvent(this.LOGLEVEL.ERROR.value, message);
};

/**
 * Log a message to a log file only if a log file was defined and we have write access to it. This
 * function appends a new line on the end of each call.
 *
 * @param logLevel {int} the log level value used to declare the level of logging this event represents. If this value
 *                       is less than the configuration log level then this event is not logged.
 * @param message {string} the message to write to the log file.
 */
module.exports.logEvent = function(logLevelForMessage, message) {
    if (logLevelForMessage <= logLevel) {
        if (logFileName != null) {
            fs.appendFile(logFileName, this.formatLogMessage(this.formatLogLevelKey(logLevel) + message), function (error) {
                if (error != null) {
                    console.log('*** Error writing to log file ' + logFileName + ": " + error.toString());
                    throw error;
                }
            });
        }
        if (logToConsole) {
            console.log(message);
        }
    }
};

/**
 * Adds current date and CRLF to a log message.
 * @param message
 * @returns {string}
 */
module.exports.formatLogMessage = function(message) {
    var today = new Date();
    return today.toISOString() + ": " + message.toString() + '\n';
};

/**
 * Return a formatted key representing the log level that was used to log the event. This way a log processor can
 * see the level that matched the log event.
 * @param logLevel
 * @returns {String} Log level identifier key with formatting.
 */
module.exports.formatLogLevelKey = function(logLevel) {
    var logInfo = this.getLogLevelInfo(logLevel);
    if (logInfo != null) {
        return '[' + logInfo.key + '] ';
    } else {
        return '';
    }
};

/**
 * Given a log level value return the related log level info.
 * @param logLevel
 * @returns {*} Object if match, null if undefined log level value.
 */
module.exports.getLogLevelInfo = function(logLevel) {
    var logInfoKey,
        logInfo;

    for (logInfoKey in this.LOGLEVEL) {
        if (this.LOGLEVEL.hasOwnProperty(logInfoKey)) {
            logInfo = this.LOGLEVEL[logInfoKey];
            if (logInfo.value == logLevel) {
                return logInfo;
            }
        }
    }
    return null;
};

/**
 * Synchronous file write for logging when we are in a critical situation, like shut down.
 * @param logLevel {int} logging level for this message.
 * @param message {string} a message to show in the log.
 */
module.exports.logEventImmediately = function(levelToLog, message) {
    if (levelToLog >= logLevel) {
        if (logFileName != null) {
            fs.appendFileSync(logFileName, this.formatLogMessage(message));
        }
        if (logToConsole) {
            console.log(message);
        }
    }
};

