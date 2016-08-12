/**
 * A proxy server built with node.js
 * Accepted URL formats:
 *    http://[yourmachine]/proxy?http://services.arcgisonline.com/ArcGIS/rest/services/?f=pjson
 *    http://[yourmachine]/sproxy?http://services.arcgisonline.com/ArcGIS/rest/services/?f=pjson
 *    http://[yourmachine]/proxy/http/services.arcgisonline.com/ArcGIS/rest/services/?f=pjson
 * The part after the proxy path is taken as the service to proxy to. It is looked up in the serviceURLs table
 * and if matched the service information of that entry is used to make the request with the service. What the
 * service responds with is then passed back to the caller.
 */

const proxyVersion = "0.1.1";
const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const urlParser = require('url');
const fs = require('fs');
const loadJsonFile = require('load-json-file');

// LOGLEVELs control what type of logging will appear in teh log file and on the console.
const LOGLEVEL = {
    ALL: {label: "ALL", value: 9, key: "A"},
    INFO: {label: "INFO", value: 5, key: "I"},
    WARN: {label: "WARN", value: 4, key: "W"},
    ERROR: {label: "ERROR", value: 3, key: "E"},
    NONE: {label: "NONE", value: 0, key: "X"}
};

var configurationFile = 'conf/config.json';
var configuration = {
    mustMatch: true,
    logFileName: null,
    logFilePath: null,
    logFile: null,
    logLevel: LOGLEVEL.ERROR.value,
    defaultLogFileName: "arcgis-proxy.txt",
    logConsole: true,
    port: 3333,
    useHTTPS: false,
    httpsKeyFile: null,
    httpsCertificateFile: null,
    httpsPfxFile: null,
    listenURI: null,
    allowedReferrers: ["*"],
    allowAnyReferrer: false,
    serverURLs: []
};
var httpServer;
var proxyServer;
var serverStartTime = null;
var attemptedRequests = 0;
var validProcessedRequests = 0;
var errorProcessedRequests = 0;

/**
 * Log a message to a log file only if a log file was defined and we have write access to it. This
 * function appends a new line on the end of each call.
 *
 * @param logLevel {int} the log level value used to declare the level of logging this event represents. If this value
 *                       is less than the configuration log level then this event is not logged.
 * @param message {string} the message to write to the log file.
 */
function logEvent(logLevel, message) {
    if (logLevel >= configuration.logLevel) {
        if (configuration.logFile != null) {
            fs.appendFile(configuration.logFile, formatLogMessage(formatLogLevelKey(logLevel) + message), function (error) {
                if (error != null) {
                    console.log('*** Error writing to log file ' + configuration.logFile + ": " + error.toString());
                    throw error;
                }
            });
        }
        if (configuration.logConsole) {
            console.log(message);
        }
    }
}

/**
 * Adds current date and CRLF to a log message.
 * @param message
 * @returns {string}
 */
function formatLogMessage(message) {
    var today = new Date();
    return today.toISOString() + ": " + message.toString() + '\n';
}

/**
 * Return a formatted key representing the log level that was used to log the event. This way a log processor can
 * see the level that matched the log event.
 * @param logLevel
 * @returns {String} Log level identifier key with formatting.
 */
function formatLogLevelKey(logLevel) {
    var logInfo = getLogLevelInfo(logLevel);
    if (logInfo != null) {
        return '[' + logInfo.key + '] ';
    } else {
        return '';
    }
}

/**
 * Convert time in milliseconds into a printable hh:mm:ss string.
 * @param timeInMilliseconds
 * @returns {string}
 */
function formatMillisecondsToHHMMSS(timeInMilliseconds) {
    var hours,
        minutes,
        seconds = timeInMilliseconds / 1000;
    hours = Math.floor(seconds / 3600);
    minutes = Math.floor(seconds / 60) % 60;
    seconds = Math.floor(seconds) % 60;
    return (hours < 10 ? '0' : '') + hours + ':' + ((minutes < 10 ? '0' : '') + minutes) + ':' + (seconds < 10 ? '0' : '') + seconds;
}
/**
 * Given a log level value return the related log level info.
 * @param logLevel
 * @returns {*} Object if match, null if undefined log level value.
 */
function getLogLevelInfo(logLevel) {
    var logInfoKey,
        logInfo;
    for (logInfoKey in LOGLEVEL) {
        logInfo = LOGLEVEL[logInfoKey];
        if (logInfo.value == logLevel) {
            return logInfo;
        }
    }
    return null;
}
/**
 * Synchronous file write for logging when we are in a critical situation, like shut down.
 * @param message
 */
function logEventImmediately(logLevel, message) {
    if (logLevel >= configuration.logLevel) {
        if (configuration.logFile != null) {
            fs.appendFileSync(configuration.logFile, formatLogMessage(message));
        }
        if (configuration.logConsole) {
            console.log(message);
        }
    }
}

/**
 * Determine if the subject string starts with the needle string. Performs a case insensitive comparison.
 * @param subject
 * @param needle
 * @returns {boolean}
 */
function startsWith (subject, needle) {
    var subjectLowerCase = subject.toLowerCase(),
        needleLowerCase = needle.toLowerCase();
    return subjectLowerCase.indexOf(needleLowerCase) == 0;
}

/**
 * Determine if the subject string ends with the needle string. Performs a case insensitive comparison.
 * @param subject
 * @param needle
 * @returns {boolean}
 */
function endsWith (subject, needle) {
    var subjectLowerCase = subject.toLowerCase(),
        needleLowerCase = needle.toLowerCase(),
        startIndex = subjectLowerCase.length - needleLowerCase.length;
    return subjectLowerCase.indexOf(needleLowerCase, startIndex) == startIndex;
}

/**
 * Determine if the configuration is valid enough to start the server. If it is not valid any reasons are
 * written to the log file and the server is not started.
 * @returns {boolean} true if valid enough.
 */
function isConfigurationValid() {
    var isValid = true;
    // allowedReferrers != empty
    // port >= 80 <= 65535
    // either httpsKeyFile && httpsCertificateFile or httpsPfxFile
    // at least one serverUrls
    if (configuration.logFilePath != null || configuration.logFileName != null) {
        if (configuration.logFilePath == null) {
            configuration.logFilePath = './';
        } else if (configuration.logFilePath.charAt(configuration.logFilePath.length) != '/') {
            configuration.logFilePath += '/';
        }
        configuration.logFile = configuration.logFilePath;
        if (configuration.logFileName != null) {
            if (configuration.logFileName.charAt(0) == '/') {
                configuration.logFile += configuration.logFileName.substr(1);
            } else {
                configuration.logFile += configuration.logFileName;
            }
        } else {
            configuration.logFile += configuration.defaultLogFileName;
        }
    }
    if (configuration.logFile != null) {
        try {
            fs.accessSync(configuration.logFilePath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (error) {
            logEventImmediately(LOGLEVEL.ERROR.value, 'No write access to log file ' + configuration.logFilePath + ": " + error.toString());
            configuration.logFile = null;
            isValid = false;
        }
    }
    if (configuration.listenURI == null) {
        logEvent(LOGLEVEL.ERROR.value, 'No URI was set to listen for.');
        isValid = false;
    } else if (configuration.listenURI.length == 0) {
        logEvent(LOGLEVEL.ERROR.value, 'No URI was set to listen for.');
        isValid = false;
    }
    if (configuration.allowedReferrers == null) {
        logEvent(LOGLEVEL.ERROR.value, 'You must configure allowedReferrers to at least one referrer, use ["*"] to accept all connections.');
        isValid = false;
    } else if (configuration.allowedReferrers.length == 0) {
        logEvent(LOGLEVEL.ERROR.value, 'You must configure allowedReferrers to at least one referrer, use ["*"] to accept all connections.');
        isValid = false;
    }
    if (configuration.serverUrls == null) {
        logEvent(LOGLEVEL.ERROR.value, 'You must configure serverUrls.');
        isValid = false;
    } else if (configuration.serverUrls.length == 0) {
        logEvent(LOGLEVEL.ERROR.value, 'You must configure serverUrls for at least one service.');
        isValid = false;
    }
    // TODO: We do not validate the individual server URLs but maybe we should?
    return isValid;
}

/**
 * Load the configuration file and process it by copying anything that looks valid into our
 * internal configuration object. This function loads asynchronously so it returns before the
 * file is loaded or processed.
 * @param configurationFile {string} path to the configuration file.
 */
function loadConfigurationFile(configurationFile) {
    loadJsonFile(configurationFile).then(function (json) {
        if (json !== null) {
            if (json.proxyConfig !== null) {
                if (json.proxyConfig.useHTTPS !== null) {
                    configuration.useHTTPS = json.proxyConfig.useHTTPS;
                }
                if (json.proxyConfig.port !== null) {
                    configuration.port = json.proxyConfig.port;
                }
                if (json.proxyConfig.mustMatch !== null) {
                    if (typeof json.proxyConfig.mustMatch == "string") {
                        configuration.mustMatch = json.proxyConfig.mustMatch.toLocaleLowerCase() == "true" || json.proxyConfig.mustMatch == "1";
                    } else {
                        configuration.mustMatch = json.proxyConfig.mustMatch;
                    }
                }
                if (json.proxyConfig.logFileName !== null) {
                    configuration.logFileName = json.proxyConfig.logFileName;
                }
                if (json.proxyConfig.logFilePath !== null) {
                    configuration.logFilePath = json.proxyConfig.logFilePath;
                }
                if (json.proxyConfig.logLevel !== null) {
                    for (var logLevel in LOGLEVEL) {
                        if (logLevel.label == json.proxyConfig.logLevel.toUpperCase()) {
                            configuration.logLevel = logLevel.value;
                            break;
                        }
                    }
                }
                // allowedReferrers can be a single string or an array of strings
                if (json.proxyConfig.allowedReferrers !== null) {
                    var allowedReferrers,
                        referrerToCheckParts,
                        referrerValidated,
                        i;

                    if (Array.isArray(json.proxyConfig.allowedReferrers)) {
                        allowedReferrers = json.proxyConfig.allowedReferrers.slice();
                    } else {
                        allowedReferrers = [json.proxyConfig.allowedReferrers];
                    }
                    // make a cache of the allowed referrers so checking at runtime is easier
                    configuration.allowedReferrers = [];
                    for (i = 0; i < allowedReferrers.length; i ++) {
                        if (allowedReferrers[i] == "*") {
                            configuration.allowAnyReferrer = true;
                            configuration.allowedReferrers.push("*");
                        } else {
                            referrerValidated = {
                                protocol: "",
                                hostname: "",
                                path: ""
                            };
                            referrerToCheckParts = urlParser.parse(allowedReferrers[i].toLowerCase().trim());
                            if (referrerToCheckParts.protocol != null) {
                                referrerValidated.protocol = referrerToCheckParts.protocol;
                            }
                            if (referrerToCheckParts.hostname != null) {
                                referrerValidated.hostname = referrerToCheckParts.hostname;
                                referrerValidated.path = referrerToCheckParts.path;
                            } else {
                                referrerValidated.hostname = referrerToCheckParts.path;
                            }
                            configuration.allowedReferrers.push(referrerValidated);
                        }
                    }
                }
                if (configuration.useHTTPS) {
                    if (json.proxyConfig.httpsKeyFile !== null) {
                        configuration.httpsKeyFile = json.proxyConfig.httpsKeyFile;
                    }
                    if (json.proxyConfig.httpsCertificateFile !== null) {
                        configuration.httpsCertificateFile = json.proxyConfig.httpsCertificateFile;
                    }
                    if (json.proxyConfig.httpsPfxFile !== null) {
                        configuration.httpsPfxFile = json.proxyConfig.httpsPfxFile;
                    }
                }
                // listenURI can be a single string or an array of strings
                if (json.proxyConfig.listenURI !== null) {
                    if (Array.isArray(json.proxyConfig.listenURI)) {
                        configuration.listenURI = json.proxyConfig.listenURI.slice();
                    } else {
                        configuration.listenURI = [json.proxyConfig.listenURI];
                    }
                }
                // serverURLs is an array of objects
                if (json.serverUrls != null) {
                    var serverUrls,
                        serverUrl,
                        urlParts,
                        i;

                    if (Array.isArray(json.serverUrls)) {
                        serverUrls = json.serverUrls.slice(); // if array copy the array
                    } else {
                        serverUrls = [json.serverUrls]; // if single object make it an array of 1
                    }
                    // iterate the array of services and validate individual settings
                    for (i = 0; i < serverUrls.length; i ++) {
                        serverUrl = serverUrls[i];
                        urlParts = urlParser.parse(serverUrl.url);
                        if (urlParts != null) {
                            serverUrl.protocol = urlParts.protocol;
                            serverUrl.hostName = urlParts.hostname;
                            serverUrl.path = urlParts.path;
                            serverUrl.port = urlParts.port;
                            if (serverUrl.protocol == null || serverUrl.protocol == "") {
                                serverUrl.protocol = "*";
                            }
                            if (serverUrl.hostName == null || serverUrl.hostName == "") {
                                serverUrl.hostName = serverUrl.path;
                                serverUrl.path = "*";
                            }
                            if (serverUrl.port == null || serverUrl.port == "") {
                                serverUrl.port = "*";
                            }
                        }
                        if (serverUrl.rateLimit != undefined) {
                            serverUrl.rateLimit = parseInt(serverUrl.rateLimit);
                            if (serverUrl.rateLimit < 0) {
                                serverUrl.rateLimit = 0;
                            }
                        } else {
                            serverUrl.rateLimit = 0;
                        }
                        if (serverUrl.rateLimitPeriod != undefined) {
                            serverUrl.rateLimitPeriod = parseInt(serverUrl.rateLimitPeriod);
                            if (serverUrl.rateLimitPeriod < 0) {
                                serverUrl.rateLimitPeriod = 0;
                            }
                        } else {
                            serverUrl.rateLimitPeriod = 0;
                        }
                    }
                    configuration.serverUrls = serverUrls;
                }
            }
        }
        // TODO: Chain promise
        if (isConfigurationValid()) {
            startServer();
        } else {
            logEvent(LOGLEVEL.ERROR.value, "!!! Server not started due to invalid configuration. !!!");
            process.exit();
        }
    });
}

/**
 * Compare two URL parts objects to determine if they match. Matching takes into account partial paths and
 * wildcards.
 * @param urlPartsSource
 * @param urlPartsTarget
 * @returns {boolean} returns true if the two objects are considered a match.
 */
function parsedUrlPartsMatch(urlPartsSource, urlPartsTarget) {
    var isMatch = false;

    if (checkDomainsMatch(urlPartsSource.hostName, urlPartsTarget.hostName)) {
        if (urlPartsSource.matchAll) {
            if (urlPartsTarget.protocol == "*" || urlPartsSource.protocol == urlPartsTarget.protocol) {
                isMatch = urlPartsTarget.path == urlPartsSource.path;
                if (isMatch) {
                    logEvent(LOGLEVEL.INFO.value, "parsedUrlPartsMatch path " + urlPartsSource.path + " " + urlPartsTarget.path + "match.");
                } else {
                    logEvent(LOGLEVEL.INFO.value, "parsedUrlPartsMatch path " + urlPartsSource.path + " " + urlPartsTarget.path + " don't match.");
                }
            } else {
                logEvent(LOGLEVEL.INFO.value, "parsedUrlPartsMatch protocol " + urlPartsSource.protocol + " " + urlPartsTarget.protocol + " don't match.");
            }
        } else {
            isMatch = startsWith(urlPartsTarget.path, urlPartsSource.path);
            if (isMatch) {
                logEvent(LOGLEVEL.INFO.value, "parsedUrlPartsMatch path " + urlPartsSource.path + " " + urlPartsTarget.path + "match.");
            } else {
                logEvent(LOGLEVEL.INFO.value, "parsedUrlPartsMatch path " + urlPartsSource.path + " " + urlPartsTarget.path + " don't match.");
            }
        }
    } else {
        logEvent(LOGLEVEL.INFO.value, "parsedUrlPartsMatch domains " + urlPartsSource.hostName + " " + urlPartsTarget.hostName + " don't match.");
    }
    return isMatch;
}

/**
 * Look up the urlRequested in the serverUrls configuration and return the matching object.
 * @param urlRequestedParts the object returns from parseURLRequest()
 * @returns {object} null if no match, otherwise the parsed and corrected URL scheme to proxy to.
 */
function getServerUrlInfo(urlRequestedParts) {
    var i,
        urlParts,
        serverUrls,
        serverUrl,
        serverUrlMatched = null;

    if (urlRequestedParts.proxyPath == null || urlRequestedParts.proxyPath == "") {
        return serverUrlMatched;
    }
    // clean and normalize the path we receive so it looks like a standard URL pattern. This usually means
    // translating /host.domain.tld/path/path into something else.
    urlParts = urlParser.parse(urlRequestedParts.proxyPath);
    serverUrls = configuration.serverUrls;
    urlParts.protocol = urlRequestedParts.protocol;
    urlParts.hostName = urlParts.hostname;
    if (urlParts.path == null || urlParts.path == "") {
        urlParts.path = urlRequestedParts.proxyPath;
    }
    if (urlParts.hostName == null || urlParts.hostName == "") {
        urlParts.hostName = urlParts.path;
        while (urlParts.hostName.length > 1 && urlParts.hostName.charAt(0) == '/') {
            urlParts.hostName = urlParts.hostName.substr(1);
        }
        i = urlParts.hostName.indexOf('/');
        if (i >= 0) {
            urlParts.path = urlParts.hostName.substr(i);
            urlParts.hostName = urlParts.hostName.substr(0, i);
        }
    }
    if (urlParts.port == null || urlParts.port == "") {
        urlParts.port = "*";
    }
    if (urlParts.query == null) {
        urlParts.query = urlRequestedParts.query;
    }
    for (i = 0; i < serverUrls.length; i ++) {
        serverUrl = serverUrls[i];
        if (parsedUrlPartsMatch(serverUrl, urlParts)) { // (matchAll && urlRequested == serverUrl.url) || ( ! matchAll && startsWith(serverUrl.url, urlRequested))) {
            logEvent(LOGLEVEL.INFO.value, "getServerUrlInfo " + urlRequestedParts.proxyPath + " matching " + serverUrl.url);
            serverUrlMatched = serverUrl;
            break;
        } else {
            logEvent(LOGLEVEL.INFO.value, "getServerUrlInfo " + urlRequestedParts.proxyPath + " no match " + serverUrl.url);
        }
    }
    return serverUrlMatched;
}

/**
 * Break apart the full URL request and determine its constituent parts. This is a bit non-standard due
 * to the special case handling of ? and &. Examples:
 *     /proxy/http/host.domain.tld/path/path?q=1&t=2
 *     /proxy?http://host.domain.tld/path/path?q=1&t=2
 *     /proxy&http://host.domain.tld/path/path?q=1&t=2
 * Returns: object:
 *   listenPath: the base URL pattern we are to be listening for
 *   proxyPath: the URI/URL pattern to proxy
 *   protocol: if part of the URI pattern we extract it
 *   query: part after a ? in the URL in case we need to pass that along
 * @param url
 * @returns {{listenPath: string, proxyPath: string, query: string, protocol: string}}
 */
function parseURLRequest(url) {
    var result = {
            listenPath: "",
            proxyPath: "",
            query: "",
            protocol: "*"
        },
        charDelimeter,
        lookFor,
        isMatch = false;

    if (url != null && url.length > 0) {
        // brute force take anything after http or https
        lookFor = '/https/';
        charDelimeter = url.indexOf(lookFor);
        if (charDelimeter >= 0) {
            isMatch = true;
            result.protocol = 'https';
            result.proxyPath = url.substr(charDelimeter + lookFor.length - 1);
            url = url.substr(0, charDelimeter );
        } else {
            lookFor = '?https://';
            charDelimeter = url.indexOf(lookFor);
            if (charDelimeter >= 0) {
                isMatch = true;
                result.protocol = 'https';
                result.proxyPath = url.substr(charDelimeter + lookFor.length - 1);
                url = url.substr(0, charDelimeter );
            } else {
                lookFor = '&https://';
                charDelimeter = url.indexOf(lookFor);
                if (charDelimeter >= 0) {
                    isMatch = true;
                    result.protocol = 'https';
                    result.proxyPath = url.substr(charDelimeter + lookFor.length - 1);
                    url = url.substr(0, charDelimeter);
                }
            }
        }
        if ( ! isMatch) {
            lookFor = '/http/';
            charDelimeter = url.indexOf(lookFor);
            if (charDelimeter >= 0) {
                isMatch = true;
                result.protocol = 'http';
                result.proxyPath = url.substr(charDelimeter + lookFor.length - 1);
                url = url.substr(0, charDelimeter);
            } else {
                lookFor = '?http://';
                charDelimeter = url.indexOf(lookFor);
                if (charDelimeter >= 0) {
                    isMatch = true;
                    result.protocol = 'http';
                    result.proxyPath = url.substr(charDelimeter + lookFor.length - 1);
                    url = url.substr(0, charDelimeter);
                } else {
                    lookFor = '&http://';
                    charDelimeter = url.indexOf(lookFor);
                    if (charDelimeter >= 0) {
                        isMatch = true;
                        result.protocol = 'http';
                        result.proxyPath = url.substr(charDelimeter + lookFor.length - 1);
                        url = url.substr(0, charDelimeter);
                    }
                }
            }
        }
        if ( ! isMatch) {
            // possible there was no protocol, now how do we figure it out?
            lookFor = '/*/';
            charDelimeter = url.indexOf(lookFor);
            if (charDelimeter >= 0) {
                isMatch = true;
                result.protocol = '*';
                result.proxyPath = url.substr(charDelimeter + lookFor.length - 1);
                url = url.substr(0, charDelimeter);
            } else {
                // TODO: if just ? or & how do we know if a path or a query string?
            }
        }
        result.listenPath = url;
        lookFor = '?'; // take anything after a ? as the query string
        charDelimeter = result.proxyPath.indexOf(lookFor);
        if (charDelimeter >= 0) {
            result.query = result.proxyPath.substr(charDelimeter + 1);
            result.proxyPath = result.proxyPath.substr(0, charDelimeter);
        }
    }
    return result;
}

/**
 * Look at two domains and see if they match by taking into account any * wildcards.
 * @param wildCardDomain
 * @param referrer
 * @returns {boolean} true if domains match
 */
function checkDomainsMatch(wildCardDomain, referrer) {
    var isMatch = true,
        i,
        domainParts,
        referrerParts;

    domainParts = wildCardDomain.split(".");
    referrerParts = referrer.split(".");
    if (domainParts.length == referrerParts.length) {
        for (i = 0; i < domainParts.length; i ++) {
            if (domainParts[i] != "*" && domainParts[i] != referrerParts[i]) {
                isMatch = false;
                break;
            }
        }
    } else {
        isMatch = false;
    }
    return isMatch;
}

/**
 * Determine if the referrer matches one of the configured allowed referrers.
 * @param referrer
 * @returns {boolean}
 */
function isValidReferrer(referrer) {
    var isValid = false,
        i,
        referrerToCheck,
        referrerToCheckParts,
        referrerToCheckHostName,
        referrerParts;

    if (referrer != undefined && referrer != null && referrer.length > 0) {
        referrerParts = urlParser.parse(referrer);
        for (i = 0; i < configuration.allowedReferrers.length; i ++) {
            referrerToCheck = configuration.allowedReferrers[i].toLowerCase().trim();
            referrerToCheckParts = urlParser.parse(referrerToCheck);
            if (referrerToCheckParts.hostname != null) {
                referrerToCheckHostName = referrerToCheckParts.hostname;
            } else {
                referrerToCheckHostName = referrerToCheckParts.path;
            }
            if (referrerToCheckParts.path == "*" || referrerParts.hostname.toLowerCase() == referrerToCheckHostName) {
                isValid = true;
                break;
            } else if (referrerToCheckHostName.indexOf("*") != -1) {
                if (checkDomainsMatch(referrerToCheckHostName, referrerParts.hostname)) {
                    isValid = true;
                    break;
                }
            }
        }
    } else if (configuration.allowAnyReferrer) {
        isValid = true;
    }
    return isValid;
}

/**
 * Determine if the URI passed is one of the URIs we are supposed to be listening for.
 * @param uri the uri that is being requested. Look this up in the serviceURLs table to make sure it is
 *    something we are supposed to service.
 * @param referrer who is making the request. match this against allowedReferrers.
 * @returns {String} '' if valid request, otherwise a reason message why it was rejected.
 */
function isValidURLRequest(uri, referrer) {
    var reason = '',
        i;

    if (isValidReferrer(referrer)) {
        for (i = 0; i < configuration.listenURI.length; i ++) {
            if (uri.toLowerCase() == configuration.listenURI[i].toLowerCase()) {
                reason = 'no matching service url for "' + uri + '".';
                break;
            }
        }
    } else {
        reason = 'referrer "' + referrer + '" not allowed.';
    }
    return reason;
}

/**
 * Calling this function means the request has passed all tests and we are going to contact the proxied service
 * and try to reply back to the caller with what it responds with.
 * @param urlRequestedParts - our object of the request components
 * @param request - the http server request object
 * @param response - the http server response object
 * @return {boolean} true if the request was processed, false if we got an error.
 */
function processValidatedRequest(urlRequestedParts, request, response) {
    var statusCode = 200,
        serverURLInfo = getServerUrlInfo(urlRequestedParts),
        requestReferrer = request.headers['referer'] || "*",
        proxyRequest;

    if (serverURLInfo != null) {

        // pipe the response from the service back to the requestor.
        // TODO: Handle GET/POST/FILES

        proxyRequest = serverURLInfo.url;
        if (serverURLInfo.query != null && serverURLInfo.query != '') {
            proxyRequest += '?' + serverURLInfo.query;
        } else if (urlRequestedParts.query != null && urlRequestedParts.query != '') {
            proxyRequest += '?' + urlRequestedParts.query;
        }

        if (proxyServer != null) {
            // Fix the request to transform it from our proxy server into a spoof of the matching request against the
            // proxied service
            request.url = proxyRequest;
            request.headers.host = serverURLInfo.hostName;
            // TODO: Not really sure this worked if the proxy generates an error
            validProcessedRequests ++;
            logEvent(LOGLEVEL.INFO.value, "Issuing proxy request [" + request.method + "](" + request.url + ") for " + proxyRequest);
            proxyServer.web(request, response, {
                target: proxyRequest,
                ignorePath: true
            });
        }
    } else {
        statusCode = 403;
        sendErrorResponse(urlRequestedParts.proxyPath, response, statusCode, "Request from " + requestReferrer + ", proxy has not been set up for " + urlRequestedParts.listenPath + ". Make sure there is a serverUrl in the configuration file that matches " + urlRequestedParts.listenPath);
    }
    return statusCode != 200;
}

/**
 * Respond to a ping request.
 * @param referrer - who asked for it.
 * @param response - response object.
 */
function sendPingResponse(referrer, response) {
    var statusCode = 200,
        responseBody = {
        "Proxy Version": proxyVersion,
        "Configuration File": "OK",
        "Log File": "OK",
        "referrer": referrer
    };
    sendJSONResponse(response, statusCode, responseBody);
    validProcessedRequests ++;
    logEvent(LOGLEVEL.INFO.value, "Ping request from " + referrer);
}

/**
 * Respond to a server status request.
 * @param referrer - who asked for it.
 * @param response - response object.
 */
function sendStatusResponse(referrer, response) {
    var timeNow = new Date(),
        statusCode = 200,
        responseBody = {
        "Proxy Version": proxyVersion,
        "Configuration File": "OK",
        "Log File": "OK",
        "Up-time": formatMillisecondsToHHMMSS(timeNow - serverStartTime),
        "Requests": attemptedRequests,
        "Requests processed": validProcessedRequests,
        "Requests rejected": errorProcessedRequests,
        "referrer": referrer
    };
    sendJSONResponse(response, statusCode, responseBody)
    validProcessedRequests ++;
    logEvent(LOGLEVEL.INFO.value, "Status request from " + referrer);
}

/**
 * Perform necessary node http-server functions to send reply in JSON format.
 * @param response - node http-server response object.
 * @param statusCode - a valid http status code (e.g. 200, 404, etc)
 * @param responseObject - a javascript object that is converted to JSON and sent back as the body.
 */
function sendJSONResponse(response, statusCode, responseObject) {
    var responseBody = JSON.stringify(responseObject);
    response.writeHead(statusCode, {
        'Content-Length': Buffer.byteLength(responseBody),
        'Content-Type': 'application/json'
    });
    response.write(responseBody);
    response.end();
}

/**
 * Reply with an error JSON object describing what may have gone wrong. This is used if there is
 * an error calling this proxy service, not for errors with the proxied service.
 * @param urlRequested the path that was requested.
 * @param response the response object so we can complete the response.
 * @param errorCode the error code we want to report to the caller.
 * @param errorMessage the error message we want to report to the caller.
 */
function sendErrorResponse(urlRequested, response, errorCode, errorMessage) {
    var responseBody = {
        error: {
            code: errorCode,
            details: errorMessage,
            message: errorMessage
        },
        request: urlRequested
    };
    sendJSONResponse(response, errorCode, responseBody);
    errorProcessedRequests ++;
    logEvent(LOGLEVEL.ERROR.value, "Request error: " + errorMessage + " (" + errorCode + ") for " + urlRequested);
}

/**
 * Determine if this request is within the rate meter threshold.
 * @param urlRequested
 * @param referrer
 * @return {boolean} true when exceeded.
 */
function isRateMeterExceeded(urlRequestedParts, referrer) {
    var isExceeded = false;
    return isExceeded;
}

/**
 * When the server receives a request we come here with the node http/https request object and
 * we fill in the response object.
 * @param request
 * @param response
 */
function processRequest(request, response) {
    var requestParts = parseURLRequest(request.url),
        rejectionReason,
        referrer;

    attemptedRequests ++;
    if (requestParts != null) {
        referrer = request.headers['referer'] || "*";
        if (requestParts.listenPath == "/ping") {
            sendPingResponse(referrer, response);
        } else {
            if (requestParts.listenPath == "/status" && isValidReferrer(referrer)) {
                sendStatusResponse(referrer, response);
            } else {
                rejectionReason = isValidURLRequest(requestParts.proxyPath, referrer);
                if (rejectionReason == '') {
                    if ( ! isRateMeterExceeded(requestParts, referrer)) {
                        processValidatedRequest(requestParts, request, response);
                    } else {
                        sendErrorResponse(request.url, response, 420, 'This is a metered resource, number of requests have exceeded the rate limit interval.');
                    }
                } else {
                    sendErrorResponse(request.url, response, 403, rejectionReason);
                }
            }
        }
    } else {
        sendErrorResponse(request.url, response, 403, 'Invalid request: could not parse request as a valid request.');
    }
}

/**
 * Run the server. This function never returns. You have to kill the process, such as ^C.
 * All requests are forwarded to processRequest(q, r).
 */
function startServer() {
    var httpsOptions,
        proxyServerOptions = {};

    serverStartTime = new Date();
    logEvent(LOGLEVEL.INFO.value, "Starting " + (configuration.useHTTPS ? 'HTTPS' : 'HTTP') + " server on port " + configuration.port + " -- " + serverStartTime.toLocaleString());

    if (configuration.useHTTPS) {
        if (configuration.httpsPfxFile != null) {
            httpsOptions = {
                pfx: fs.readFileSync(configuration.httpsPfxFile)
            };
        } else {
            httpsOptions = {
                key: fs.readFileSync(configuration.httpsKeyFile),
                cert: fs.readFileSync(configuration.httpsCertificateFile)
            };
        }
        httpServer = https.createServer(httpsOptions, processRequest);
    } else {
        httpServer = http.createServer(processRequest);
    }
    if (httpServer != null) {
        httpServer.on('clientError', function (error, socket) {
            errorProcessedRequests ++;
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        });

        proxyServer = new httpProxy.createProxyServer(proxyServerOptions);
        proxyServer.on('error', function (proxyError, proxyRequest, proxyResponse) {
            sendErrorResponse(proxyRequest.url, proxyResponse, 500, 'Proxy error ' + proxyError.toString());
        });
        httpServer.listen(configuration.port);
    }
}

/**
 * Perform any actions when the app is terminated.
 * @param options
 * @param error
 */
function exitHandler(options, error) {
    logEventImmediately(LOGLEVEL.INFO.value, 'Stopping server via ' + options.reason);
    if (error) {
        console.log(error.stack);
    }
    if (options.exit) {
        if (proxyServer != null) {
            proxyServer.close();
        }
        process.exit();
    }
}

function runTests() {
    var testStr;
    var targetStr;
    var result;

    testStr = 'server.com';
    targetStr = 'server.com';
    result = checkDomainsMatch(testStr, targetStr)
    console.log('checkDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.server.com';
    targetStr = 'service.server.com';
    result = checkDomainsMatch(testStr, targetStr)
    console.log('checkDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '*.server.com';
    targetStr = 'www.server.com';
    result = checkDomainsMatch(testStr, targetStr)
    console.log('checkDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.xyz.server.com';
    targetStr = 'service.xyz.server.com';
    result = checkDomainsMatch(testStr, targetStr)
    console.log('checkDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.sdjfh.server.com';
    targetStr = 'www.jsadfoij.server.com';
    result = checkDomainsMatch(testStr, targetStr)
    console.log('checkDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.*.server.com';
    targetStr = 'www.jsadfoij.server.com';
    result = checkDomainsMatch(testStr, targetStr)
    console.log('checkDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://';
    result = startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'https://';
    result = startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = '';
    result = startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '';
    targetStr = '';
    result = startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '';
    targetStr = 'http://';
    result = startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://server.com/application1';
    result = startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://server.com/application1-xxx';
    result = startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://';
    result = endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'on1';
    result = endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = '';
    result = endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '';
    targetStr = 'http:';
    result = endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://server.com/application1';
    result = endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));
}

process.stdin.resume(); // so the program will not close instantly

// Set handler for app shutdown event
process.on('exit', exitHandler.bind(null, {reason: "normal exit"}));
process.on('SIGINT', exitHandler.bind(null, {exit:true, reason: "app terminated via SIGINT"}));
process.on('uncaughtException', exitHandler.bind(null, {exit:true, reason: "uncaught exception"}));

loadConfigurationFile(configurationFile);
