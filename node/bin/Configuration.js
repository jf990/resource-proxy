/**
 * Configuration file parser, validator, and accessor. Calling loadConfigurationFile returns a promise that will
 * resolve once the config is loaded, parsed, and validated.
 */

const loadJsonFile = require('load-json-file');
const ProjectUtilities = require('./ProjectUtilities');
const QuickLogger = require('./QuickLogger');
const UrlFlexParser = require('./UrlFlexParser');

const defaultConfigurationFile = 'conf/config.json';

var configuration = {
    mustMatch: true,
    logLevel: QuickLogger.LOGLEVEL.ERROR.value,
    logConsole: true,
    logFunction: null,
    localPingURL: '/ping',
    localStatusURL: '/status',
    port: 3333, // 80
    useHTTPS: false,
    httpsKeyFile: null,
    httpsCertificateFile: null,
    httpsPfxFile: null,
    listenURI: null,
    allowedReferrers: ['*'],
    allowAnyReferrer: false,
    serverURLs: []
};
var configurationComplete = false;

/**
 * Return true if the server URL definition for this resource is to support user login (user name+password). We use this to
 * get the secure token.
 * @param serverURLInfo {object} the server URL definition to check.
 * @returns {boolean}
 */
function isUserLogin (serverURLInfo) {
    if (serverURLInfo != null) {
        return serverURLInfo.username !== undefined && serverURLInfo.username.trim().length > 0 && serverURLInfo.password !== undefined && serverURLInfo.password.trim().length > 0;
    } else {
        return false;
    }
}

/**
 * Return true if the server URL definition for this resource is to support app login (clientId). We use this to
 * get the secure token with OAuth.
 * @param serverURLInfo {object} the server URL definition to check.
 * @returns {boolean}
 */
function isAppLogin (serverURLInfo) {
    if (serverURLInfo != null) {
        return serverURLInfo.clientid !== undefined && serverURLInfo.clientid.trim().length > 0 && serverURLInfo.clientsecret !== undefined && serverURLInfo.clientsecret.trim().length > 0;
    } else {
        return false;
    }
}

/**
 * Determine if the configuration is valid enough to start the server. If it is not valid any reasons are
 * written to the log file and the server is not started.
 * @returns {boolean} true if valid enough.
 */
function isConfigurationValid () {
    var isValid,
        serverUrl,
        i;

    // allowedReferrers != empty
    // port >= 80 <= 65535
    // either httpsKeyFile && httpsCertificateFile or httpsPfxFile
    // at least one serverUrls
    isValid = QuickLogger.setConfiguration(configuration);
    if (configuration.listenURI == null) {
        QuickLogger.logErrorEvent('No URI was set to listen for. Indicate a URI path on your server, for example /proxy');
        isValid = false;
    } else if (configuration.listenURI.length == 0) {
        QuickLogger.logErrorEvent('No URI was set to listen for. Indicate a URI path on your server, for example /proxy');
        isValid = false;
    }
    if (configuration.serverUrls == null) {
        QuickLogger.logErrorEvent('You must configure serverUrls.');
        isValid = false;
    } else if (configuration.serverUrls.length == 0) {
        QuickLogger.logErrorEvent('You must configure serverUrls for at least one service.');
        isValid = false;
    } else {
        for (i = 0; i < configuration.serverUrls.length; i ++) {
            serverUrl = configuration.serverUrls[i];
            if (serverUrl.errorMessage != '') {
                isValid = false;
                QuickLogger.logErrorEvent('Error(s) in the server URL definitions for ' + serverUrl.url + ': ' + serverUrl.errorMessage);
            }
        }
    }
    // TODO: We do not validate the individual server URLs but maybe we should?
    if (configuration.allowedReferrers == null) {
        configuration.allowedReferrers = ['*'];
        QuickLogger.logWarnEvent('You should configure allowedReferrers to at least one referrer, use ["*"] to accept all connections. Defaulting to ["*"].');
    } else if (configuration.allowedReferrers.length == 0) {
        configuration.allowedReferrers = ['*'];
        QuickLogger.logWarnEvent('You should configure allowedReferrers to at least one referrer, use ["*"] to accept all connections. Defaulting to ["*"].');
    }
    return isValid;
}

/**
 * Load the configuration file and process it by copying anything that looks valid into our
 * internal configuration object. This function loads asynchronously so it returns before the
 * file is loaded or processed.
 * @param configFile {string} path to the configuration file.
 */
function loadConfigurationFile (configFile) {
    var allowedReferrers,
        referrerToCheckParts,
        referrerValidated,
        serverUrls,
        serverUrl,
        urlParts,
        logLevel,
        promise,
        i;

    promise = new Promise(function(resolvePromise, rejectPromise) {
        if (configFile == undefined || configFile == null || configFile.length == 0) {
            configFile = defaultConfigurationFile;
        }
        loadJsonFile(configFile).then(function (json) {
            if (json !== null) {
                if (json.proxyConfig !== null) {
                    if (json.proxyConfig.useHTTPS !== null) {
                        configuration.useHTTPS = json.proxyConfig.useHTTPS;
                    }
                    if (json.proxyConfig.port !== null) {
                        configuration.port = json.proxyConfig.port;
                    }
                    if (json.proxyConfig.mustMatch !== null) {
                        if (typeof json.proxyConfig.mustMatch === 'string') {
                            configuration.mustMatch = json.proxyConfig.mustMatch.toLocaleLowerCase().trim() === 'true' || json.proxyConfig.mustMatch === '1';
                        } else {
                            configuration.mustMatch = json.proxyConfig.mustMatch;
                        }
                    } else {
                        configuration.mustMatch = true;
                    }
                    if (json.proxyConfig.matchAllReferrer !== null) {
                        if (typeof json.proxyConfig.matchAllReferrer === 'string') {
                            configuration.matchAllReferrer = json.proxyConfig.matchAllReferrer.toLocaleLowerCase().trim() === 'true' || json.proxyConfig.matchAllReferrer === '1';
                        } else {
                            configuration.matchAllReferrer = json.proxyConfig.matchAllReferrer;
                        }
                    } else {
                        configuration.matchAllReferrer = true;
                    }
                    if (json.proxyConfig.logFileName !== null) {
                        configuration.logFileName = json.proxyConfig.logFileName;
                    }
                    if (json.proxyConfig.logFilePath !== null) {
                        configuration.logFilePath = json.proxyConfig.logFilePath;
                    }
                    if (json.proxyConfig.logLevel !== null) {
                        for (logLevel in QuickLogger.LOGLEVEL) {
                            if (QuickLogger.LOGLEVEL.hasOwnProperty(logLevel)) {
                                if (QuickLogger.LOGLEVEL[logLevel].label == json.proxyConfig.logLevel.toUpperCase()) {
                                    configuration.logLevel = QuickLogger.LOGLEVEL[logLevel].value;
                                    break;
                                }
                            }
                        }
                    }
                    if (json.proxyConfig.logToConsole !== null) {
                        if (typeof json.proxyConfig.logToConsole === 'string') {
                            configuration.logToConsole = json.proxyConfig.logToConsole.toLocaleLowerCase().trim() === 'true' || json.proxyConfig.logToConsole === '1';
                        } else {
                            configuration.logToConsole = json.proxyConfig.logToConsole == true;
                        }
                    } else {
                        configuration.logToConsole = false;
                    }
                    // allowedReferrers can be a single string, items separated with comma, or an array of strings.
                    // Make sure we end up with an array of strings.
                    if (json.proxyConfig.allowedReferrers !== null) {
                        if (Array.isArray(json.proxyConfig.allowedReferrers)) {
                            allowedReferrers = json.proxyConfig.allowedReferrers.slice();
                        } else if (json.proxyConfig.allowedReferrers.indexOf(',') >= 0) {
                            allowedReferrers = json.proxyConfig.allowedReferrers.split(',');
                        } else {
                            allowedReferrers = [json.proxyConfig.allowedReferrers];
                        }
                        // make a cache of the allowed referrers so checking at runtime is easier and avoids parsing the referrer on each lookup
                        configuration.allowedReferrers = [];
                        for (i = 0; i < allowedReferrers.length; i ++) {
                            referrerValidated = {
                                protocol: '*',
                                hostname: '*',
                                path: '*',
                                referrer: '*'
                            };
                            if (allowedReferrers[i] == "*") {
                                // TODO: this may not be necessary because when we match a * we don't check the individual parts
                                configuration.allowAnyReferrer = true;
                                configuration.allowedReferrers.push(referrerValidated);
                            } else {
                                referrerToCheckParts = UrlFlexParser.parseAndFixURLParts(allowedReferrers[i].toLowerCase().trim());
                                if (referrerToCheckParts.protocol != null) {
                                    referrerValidated.protocol = referrerToCheckParts.protocol;
                                }
                                if (referrerToCheckParts.hostname != null) {
                                    referrerValidated.hostname = referrerToCheckParts.hostname;
                                    referrerValidated.path = referrerToCheckParts.path;
                                } else {
                                    referrerValidated.hostname = referrerToCheckParts.path;
                                }
                                referrerValidated.referrer = UrlFlexParser.fullReferrerURLFromParts(referrerValidated); // used for the database key for this referrer match
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
                    if (json.proxyConfig.pingPath !== null) {
                        configuration.localPingURL = json.proxyConfig.pingPath;
                    }
                    if (json.proxyConfig.statusPath !== null) {
                        configuration.localStatusURL = json.proxyConfig.statusPath;
                    }
                    // serverURLs is an array of objects
                    if (json.serverUrls != null) {
                        if (Array.isArray(json.serverUrls)) {
                            serverUrls = json.serverUrls.slice(); // if array copy the array
                        } else {
                            serverUrls = [json.serverUrls]; // if single object make it an array of 1
                        }
                        // iterate the array of services and validate individual settings
                        for (i = 0; i < serverUrls.length; i ++) {
                            serverUrl = serverUrls[i];
                            // if the config file uses the old format {serverUrls: { serverUrl: { ... }} then convert it to the newer format.
                            if (serverUrl.serverUrl !== undefined) {
                                serverUrl = serverUrl.serverUrl;
                            }
                            serverUrl.errorMessage = '';
                            urlParts = UrlFlexParser.parseAndFixURLParts(serverUrl.url);
                            if (urlParts != null) {
                                serverUrl.protocol = urlParts.protocol;
                                serverUrl.hostname = urlParts.hostname;
                                serverUrl.path = urlParts.path;
                                serverUrl.port = urlParts.port;
                                if (serverUrl.protocol == null || serverUrl.protocol == '') {
                                    serverUrl.protocol = '*';
                                }
                                if (serverUrl.protocol.charAt(serverUrl.protocol.length - 1) == ':') {
                                    serverUrl.protocol = serverUrl.protocol.substr(0, serverUrl.protocol.length - 1);
                                }
                                if (serverUrl.hostname == null || serverUrl.hostname == '') {
                                    serverUrl.hostname = serverUrl.path;
                                    serverUrl.path = '*';
                                }
                                if (serverUrl.port == null || serverUrl.port == '') {
                                    serverUrl.port = '*';
                                }
                            }
                            if (serverUrl.matchAll !== undefined) {
                                if (typeof serverUrl.matchAll === 'string') {
                                    serverUrl.matchAll = serverUrl.matchAll.toLocaleLowerCase().trim() === 'true' || serverUrl.matchAll == '1';
                                }
                            } else {
                                serverUrl.matchAll = true;
                            }
                            if (serverUrl.rateLimit !== undefined) {
                                serverUrl.rateLimit = parseInt(serverUrl.rateLimit);
                                if (serverUrl.rateLimit < 0) {
                                    serverUrl.rateLimit = 0;
                                }
                            } else {
                                serverUrl.rateLimit = 0;
                            }
                            if (serverUrl.rateLimitPeriod !== undefined) {
                                serverUrl.rateLimitPeriod = parseInt(serverUrl.rateLimitPeriod);
                                if (serverUrl.rateLimitPeriod < 0) {
                                    serverUrl.rateLimitPeriod = 0;
                                }
                            } else {
                                serverUrl.rateLimitPeriod = 0;
                            }
                            if (serverUrl.rateLimit > 0 && serverUrl.rateLimitPeriod > 0) {
                                serverUrl.useRateMeter = true;
                                serverUrl.rate = serverUrl.rateLimit / serverUrl.rateLimitPeriod / 60; // how many we give out per second
                                serverUrl.ratePeriodSeconds = 1 / serverUrl.rate; // how many seconds in 1 rate period
                            } else {
                                serverUrl.useRateMeter = false;
                                serverUrl.rate = 0;
                                serverUrl.ratePeriodSeconds = 0;
                            }
                            if (serverUrl.hostRedirect !== undefined && serverUrl.hostRedirect.trim().length > 0) {
                                serverUrl.parsedHostRedirect = UrlFlexParser.parseAndFixURLParts(serverUrl.hostRedirect.trim());
                                serverUrl.isHostRedirect = true;
                            } else {
                                serverUrl.isHostRedirect = false;
                            }
                            if (ProjectUtilities.isPropertySet(serverUrl, 'clientId') || ProjectUtilities.isPropertySet(serverUrl, 'clientSecret') || ProjectUtilities.isPropertySet(serverUrl, 'oauth2Endpoint')) {
                                serverUrl.clientId = ProjectUtilities.getIfPropertySet(serverUrl, 'clientId', '');
                                serverUrl.clientSecret = ProjectUtilities.getIfPropertySet(serverUrl, 'clientSecret', '');
                                serverUrl.oauth2Endpoint = ProjectUtilities.getIfPropertySet(serverUrl, 'oauth2Endpoint', '');
                                if (serverUrl.clientId.length < 1 || serverUrl.clientSecret.length < 1 || serverUrl.oauth2Endpoint < 1) {
                                    serverUrl.errorMessage = 'When using OAuth a setting for clientId, clientSecret, and oauth2Endpoint must all be provided. At least one is missing.';
                                }
                            }
                            serverUrl.isUserLogin = isUserLogin(serverUrl);
                            serverUrl.isAppLogin = isAppLogin(serverUrl);
                            if (ProjectUtilities.isPropertySet(serverUrl, 'username') || ProjectUtilities.isPropertySet(serverUrl, 'password')) {
                                serverUrl.username = ProjectUtilities.getIfPropertySet(serverUrl, 'username', '');
                                serverUrl.password = ProjectUtilities.getIfPropertySet(serverUrl, 'password', '');
                                if (serverUrl.username.length < 1 || serverUrl.password.length < 1) {
                                    serverUrl.errorMessage = 'When using username/password both must all be provided. At least one is missing.';
                                }
                            }
                            // TODO: Should we attempt to validate any of the following parameters?
                            // domain;
                            // accessToken;
                            // tokenParamName;
                        }
                        configuration.serverUrls = serverUrls;
                    }
                }
            }
            configurationComplete = true;
            if (isConfigurationValid()) {
                configuration.logFunction = QuickLogger.logEvent.bind(QuickLogger);
                resolvePromise();
            } else {
                rejectPromise(new Error('Configuration file not valid, check log or error console for more information.'));
            }
        }, function (error) {
            QuickLogger.logErrorEvent('!!! Invalid configuration file format. ' + error.toString() + ' !!!');
        });
    });
    return promise;
}

module.exports.configuration = configuration;
module.exports.isConfigurationValid = isConfigurationValid;
module.exports.loadConfigurationFile = loadConfigurationFile;

