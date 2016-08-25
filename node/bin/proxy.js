/**
 * A proxy server built with node.js and tailored to the ArcGIS platform. See README for description
 * of functionality and configuration.
 *
 * John's to-do list:
 * * test hostRedirect test with http://local.arcgis.com:3333/proxy/geo.arcgis.com/ArcGIS/rest/info/
 * * GET making sure all the query parameters are correct
 * * POST
 * * FILES
 * * adding token to request without a token
 * * replace token to a request that has a token but we dont want to use it
 * * If proxied request fails due to 499/498/403, catching that and retry with credentials or refresh token
 * * username/password
 * * tokenServiceUri
 * * oauth, clientId, clientSecret, oauthEndpoint, accessToken
 */

const proxyVersion = "0.1.3";
const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const fs = require('fs');
const loadJsonFile = require('load-json-file');
const RateMeter = require('./RateMeter');
const ProjectUtilities = require('./ProjectUtilities');
const QuickLogger = require('./QuickLogger');
const UrlFlexParser = require('./UrlFlexParser');


var defaultConfigurationFile = 'conf/config.json';
var configuration = {
    mustMatch: true,
    logLevel: QuickLogger.LOGLEVEL.ERROR.value,
    logConsole: true,
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
var httpServer;
var proxyServer;
var rateMeter = null;
var serverStartTime = null;
var attemptedRequests = 0;
var validProcessedRequests = 0;
var errorProcessedRequests = 0;
var configurationComplete = false;
var waitingToRunIntegrationTests = false;


/**
 * Determine if the configuration is valid enough to start the server. If it is not valid any reasons are
 * written to the log file and the server is not started.
 * @returns {boolean} true if valid enough.
 */
function isConfigurationValid () {
    var isValid;
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
        i;

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
                            referrerValidated.referrer = fullURLFromParts(referrerValidated); // used for the database key for this referrer match
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
                        if (serverUrl.matchAll != undefined) {
                            if (typeof serverUrl.matchAll === 'string') {
                                serverUrl.matchAll = serverUrl.matchAll.toLocaleLowerCase().trim() === 'true' || serverUrl.matchAll == '1';
                            }
                        } else {
                            serverUrl.matchAll = true;
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
                        if (serverUrl.rateLimit > 0 && serverUrl.rateLimitPeriod > 0) {
                            serverUrl.useRateMeter = true;
                            serverUrl.rate = serverUrl.rateLimit / serverUrl.rateLimitPeriod / 60; // how many we give out per second
                            serverUrl.ratePeriodSeconds = 1 / serverUrl.rate; // how many seconds in 1 rate period
                        } else {
                            serverUrl.useRateMeter = false;
                            serverUrl.rate = 0;
                            serverUrl.ratePeriodSeconds = 0;
                        }
                        // TODO: Should we attempt to validate any of the following parameters?
                        // hostRedirect;
                        // oauth2Endpoint;
                        // domain;
                        // username;
                        // password;
                        // clientId;
                        // clientSecret;
                        // accessToken;
                        // tokenParamName;
                    }
                    configuration.serverUrls = serverUrls;
                }
            }
        }
        // TODO: Chain promise
        configurationComplete = true;
        if (isConfigurationValid()) {
            configuration.logFunction = QuickLogger.logEvent.bind(QuickLogger);
            UrlFlexParser.setConfiguration(configuration);
            startServer();
        } else {
            QuickLogger.logErrorEvent("!!! Server not started due to invalid configuration. !!!");
            process.exit();
        }
    }, function (error) {
        QuickLogger.logErrorEvent("!!! Server not started due to invalid configuration file format. " + error.toString() + " !!!");
    });
}

/**
 * Look up the urlRequested in the serverUrls configuration and return the matching object.
 * @param urlRequestedParts the object returns from parseURLRequest()
 * @returns {object} null if no match, otherwise the parsed and corrected URL scheme to proxy to.
 */
function getServerUrlInfo (urlRequestedParts) {
    var i,
        urlParts,
        serverUrls,
        serverUrl,
        serverUrlMatched = null;

    if (urlRequestedParts.proxyPath == null || urlRequestedParts.proxyPath == '') {
        return serverUrlMatched;
    }
    // clean and normalize the path we receive so it looks like a standard URL pattern. This usually means
    // translating /host.domain.tld/path/path into something else.
    urlParts = UrlFlexParser.parseAndFixURLParts(urlRequestedParts.proxyPath);
    serverUrls = configuration.serverUrls;
    urlParts.protocol = urlRequestedParts.protocol;
    if (urlParts.protocol.charAt(urlParts.protocol.length - 1) == ':') {
        urlParts.protocol = urlParts.protocol.substr(0, urlParts.protocol.length - 1);
    }
    if (urlParts.path == null || urlParts.path == '') {
        urlParts.path = urlRequestedParts.proxyPath;
    }
    // if we don't parse a host name then we are going to assume the host name is encoded in the path,
    // then take that piece out of the path
    if (urlParts.hostname == null || urlParts.hostname == '') {
        urlParts.hostname = urlParts.path;
        while (urlParts.hostname.length > 1 && urlParts.hostname.charAt(0) == '/') {
            urlParts.hostname = urlParts.hostname.substr(1);
        }
        i = urlParts.hostname.indexOf('/');
        if (i >= 0) {
            urlParts.path = urlParts.hostname.substr(i);
            urlParts.hostname = urlParts.hostname.substr(0, i);
        }
        urlParts.path = urlParts.path.replace(urlParts.hostname, '');
    }
    if (urlParts.port == null || urlParts.port == '') {
        urlParts.port = '*';
    }
    if (urlParts.query == null) {
        urlParts.query = urlRequestedParts.query;
    }
    for (i = 0; i < serverUrls.length; i ++) {
        serverUrl = serverUrls[i];
        if (UrlFlexParser.parsedUrlPartsMatch(urlParts, serverUrl)) { // (matchAll && urlRequested == serverUrl.url) || ( ! matchAll && startsWith(serverUrl.url, urlRequested))) {
            QuickLogger.logInfoEvent('getServerUrlInfo ' + urlRequestedParts.proxyPath + ' matching ' + serverUrl.url);
            serverUrlMatched = serverUrl;
            break;
        } else {
            QuickLogger.logInfoEvent('getServerUrlInfo ' + urlRequestedParts.proxyPath + ' no match ' + serverUrl.url);
        }
    }
    return serverUrlMatched;
}

/**
 * Determine if the URI requested is one of the URIs we are supposed to be listening for in listenURI[].
 * Since on the node.js server we can listen on any URI request we must specify the path we will accept.
 * If mustMatch is false then we will listen for anything! (Not sure if this is really useful.)
 * @param uri the uri that is being requested. Look this up in the serviceURLs table to make sure it is
 *    something we are supposed to service.
 * @returns {String} '' if valid request, otherwise a reason message why it was rejected.
 */
function isValidURLRequest (uri) {
    var reason = '',
        i;

    if (configuration.mustMatch) {
        for (i = 0; i < configuration.listenURI.length; i ++) {
            if (uri.toLowerCase() == configuration.listenURI[i].toLowerCase()) {
                reason = 'no matching service url for "' + uri + '".';
                break;
            }
        }
    }
    return reason;
}

function isUserLogin (serverURLInfo) {
    if (serverURLInfo != null) {
        return serverURLInfo.username != null && serverURLInfo.username.length > 0 && serverURLInfo.password != null && serverURLInfo.password.length > 0;
    } else {
        return false;
    }
}

function isAppLogin (serverURLInfo) {
    if (serverURLInfo != null) {
        return serverURLInfo.clientid != null && serverURLInfo.clientid.length > 0 && serverURLInfo.clientsecret != null && serverURLInfo.clientsecret.length > 0;
    } else {
        return false;
    }
}

/**
 * Calling this function means the request has passed all tests and we are going to contact the proxied service
 * and try to reply back to the caller with what it responds with.
 * @param urlRequestedParts - our object of the request components.
 * @param referrer {string} the validated referrer we are tracking (can be "*").
 * @param request - the http server request object.
 * @param response - the http server response object.
 * @return {boolean} true if the request was processed, false if we got an error.
 */
function processValidatedRequest (urlRequestedParts, serverURLInfo, referrer, request, response) {
    var statusCode = 200,
        proxyRequest,
        parsedHostRedirect,
        parsedProxy,
        hostname;

    if (serverURLInfo != null) {
        // pipe the response from the service back to the requestor.
        // TODO: Handle Auth, oauth, GET/POST/FILES

        if (proxyServer != null) {
            if (ProjectUtilities.isPropertySet(serverURLInfo, 'hostRedirect')) {
                // Host Redirect means we want to replace the host used in the request with a different host, but keep
                // everything else received in the request (path, query).
                // TODO: probably should do this at config time not on every request.
                parsedHostRedirect = UrlFlexParser.parseAndFixURLParts(serverURLInfo.hostRedirect);
                parsedProxy = UrlFlexParser.parseAndFixURLParts(urlRequestedParts.proxyPath);
                parsedProxy.hostname = parsedHostRedirect.hostname;
                parsedProxy.protocol = UrlFlexParser.getBestMatchProtocol(referrer, parsedProxy, parsedHostRedirect);
                parsedProxy.port = UrlFlexParser.getBestMatchPort(referrer, parsedProxy, parsedHostRedirect);
                proxyRequest = UrlFlexParser.buildFullURLFromParts(parsedProxy);
                hostname = parsedProxy.hostname;
            } else {
                proxyRequest = UrlFlexParser.buildURLFromReferrerRequestAndInfo(referrer, urlRequestedParts, serverURLInfo);
                hostname = serverURLInfo.hostname;
            }
            // Fix the request to transform it from our proxy server into a spoof of the matching request against the
            // proxied service
            request.url = proxyRequest;
            request.headers.host = hostname;
            // TODO: Not really sure this worked if the proxy generates an error as we are not catching any error from the proxied service
            validProcessedRequests ++;
            QuickLogger.logInfoEvent("Issuing proxy request [" + request.method + "](" + request.url + ") for " + proxyRequest);
            proxyServer.web(request, response, {
                target: proxyRequest,
                ignorePath: true
            });
        }
    } else {
        statusCode = 403;
        sendErrorResponse(urlRequestedParts.proxyPath, response, statusCode, "Request from " + referrer + ", proxy has not been set up for " + urlRequestedParts.listenPath + ". Make sure there is a serverUrl in the configuration file that matches " + urlRequestedParts.listenPath);
    }
    return statusCode != 200;
}

/**
 * Respond to a ping request. A ping tells a client we are alive and gives out some status response.
 * @param referrer {string} - who asked for it.
 * @param response {object} - http response object.
 */
function sendPingResponse (referrer, response) {
    var statusCode = 200,
        responseBody = {
            "Proxy Version": proxyVersion,
            "Configuration File": "OK",
            "Log File": "OK",
            "referrer": referrer
        };
    sendJSONResponse(response, statusCode, responseBody);
    validProcessedRequests ++;
    QuickLogger.logInfoEvent("Ping request from " + referrer);
}

/**
 * Respond to a server status request.
 * @param referrer - who asked for it.
 * @param response - http response object.
 */
function sendStatusResponse (referrer, response) {
    var timeNow = new Date(),
        responseObject = {
            "Proxy Version": proxyVersion,
            "Configuration File": "OK",
            "Log File": "OK",
            "Up-time": formatMillisecondsToHHMMSS(timeNow - serverStartTime),
            "Requests": attemptedRequests,
            "Requests processed": validProcessedRequests,
            "Requests rejected": errorProcessedRequests,
            "Referrers Allowed": configuration.allowedReferrers.map(function (allowedReferrer) {
                return allowedReferrer.referrer;
            }).join(', '),
            "Referrer": referrer,
            "Rate Meter": []
        };
    if (rateMeter != null) {
        rateMeter.databaseDump().then(function (responseIsArrayOfTableRows) {
            responseObject['Rate Meter'] = responseIsArrayOfTableRows;
            reportHTMLStatusResponse(responseObject, response);
        }, function (databaseError) {
            responseObject.error = databaseError.toLocaleString();
            reportHTMLStatusResponse(responseObject, response);
        });
    }
    QuickLogger.logInfoEvent("Status request from " + referrer);
}

/**
 * Create an HTML dump of some valuable information regarding the current status of the proxy server.
 * @param responseObject {Object} we iterate this object as the information to report.
 * @param response {Object} the http response object to write to.
 */
function reportHTMLStatusResponse (responseObject, response) {
    var responseBody,
        key,
        value,
        row,
        rowKey,
        rowValue,
        tableRow,
        i,
        statusCode = 200;

    responseBody = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>Resource Proxy Status</title>\n</head>\n<body>\n\n<h1>Resource Proxy Status</h1>';
    for (key in responseObject) {
        if (responseObject.hasOwnProperty(key)) {
            value = responseObject[key];
            if (value instanceof Array) { // Arrays get displayed as tables
                responseBody += '<p><strong>' + key + ':</strong></p><table>';
                for (i = 0; i < value.length; i ++) {
                    tableRow = '<tr>';
                    row = value[i];
                    for (rowKey in row) {
                        if (row.hasOwnProperty(rowKey)) {
                            if (i == 0) {
                                responseBody += '<th>' + rowKey + '</th>';
                            }
                            rowValue = row[rowKey];
                            tableRow += '<td>' + rowValue + '</td>';
                        }
                    }
                    responseBody += '</tr>' + tableRow;
                }
                if (value.length == 0) {
                    responseBody += '<tr><td>** empty **</td>';
                }
                responseBody += '</tr></table>'
            } else {
                responseBody += '<p><strong>' + key + ':</strong> ' + value + '</p>\n';
            }
        }
    }
    responseBody += '\n</body></html>\n';
    response.writeHead(statusCode, {
        'Content-Length': Buffer.byteLength(responseBody),
        'Content-Type': 'text/html'
    });
    response.write(responseBody);
    response.end();
}

/**
 * Perform necessary node http-server functions to send reply in JSON format.
 * @param response - node http-server response object.
 * @param statusCode - a valid http status code (e.g. 200, 404, etc)
 * @param responseObject - a javascript object that is converted to JSON and sent back as the body.
 */
function sendJSONResponse (response, statusCode, responseObject) {
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
function sendErrorResponse (urlRequested, response, errorCode, errorMessage) {
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
    QuickLogger.logErrorEvent("Request error: " + errorMessage + " (" + errorCode + ") for " + urlRequested);
}

/**
 * Determine if this request is within the rate meter threshold. If it is we continue to processValidatedRequest().
 * If it is not we generate the client reply here.
 * @param referrer {string} the validated referrer we are tracking (can be "*").
 * @param requestParts - the parsed URL that is being requested
 * @param serverURLInfo - the serverUrls object matching this request
 * @param request - the http request object, needed to pass on to processValidatedRequest or error response
 * @param response - the http response object, needed to pass on to processValidatedRequest or error response
 */
function checkRateMeterThenProcessValidatedRequest (referrer, requestParts, serverURLInfo, request, response) {
    var statusCode = 200;
    if (rateMeter != null) {
        rateMeter.isUnderRate(referrer, serverURLInfo).then(function (isUnderCap) {
            if (isUnderCap) {
                processValidatedRequest(requestParts, serverURLInfo, referrer, request, response);
            } else {
                statusCode = 420;
                QuickLogger.logWarnEvent("RateMeter dissallowing access to " + serverURLInfo.url + " from " + referrer);
                sendErrorResponse(request.url, response, statusCode, 'This is a metered resource, number of requests have exceeded the rate limit interval.');
            }
        }, function (error) {
            statusCode = 420;
            QuickLogger.logErrorEvent("RateMeter failed on " + serverURLInfo.url + " from " + referrer + ": " + error.toString());
            sendErrorResponse(request.url, response, statusCode, 'This is a metered resource but the server failed to determine the meter status of this resource.');
        });
    }
    return statusCode;
}

/**
 * When the server receives a request we come here with the node http/https request object and
 * we fill in the response object.
 * @param request
 * @param response
 */
function processRequest (request, response) {
    var requestParts = UrlFlexParser.parseURLRequest(request.url, configuration.listenURI),
        serverURLInfo,
        rejectionReason,
        referrer,
        proxyReferrer;

    attemptedRequests ++;
    if (requestParts != null) {
        referrer = request.headers['referer'];
        if (referrer == null || referrer.length < 1) {
            referrer = '*';
        } else {
            referrer = referrer.toLowerCase().trim();
        }
        QuickLogger.logInfoEvent('---- New request from ' + referrer + ' for ' + requestParts.listenPath + ' ----');
        if (requestParts.listenPath == configuration.localPingURL) {
            sendPingResponse(referrer, response);
        } else {
            referrer = UrlFlexParser.validatedReferrerFromReferrer(referrer);
            if (referrer != null) {
                if (requestParts.listenPath == configuration.localStatusURL) {
                    sendStatusResponse(referrer, response);
                } else {
                    rejectionReason = isValidURLRequest(requestParts.proxyPath);
                    if (rejectionReason == '') {
                        proxyReferrer = request.headers['referer'];
                        serverURLInfo = getServerUrlInfo(requestParts);
                        if (serverURLInfo != null) {
                            if (serverURLInfo.useRateMeter) {
                                checkRateMeterThenProcessValidatedRequest(referrer, requestParts, serverURLInfo, request, response);
                            } else {
                                processValidatedRequest(requestParts, serverURLInfo, referrer, request, response);
                            }
                        } else if (! configuration.mustMatch) {
                            // when mustMatch is false we accept absolutely anything (why, again, are we doing this?) so blindly forward the request on and cross your fingers someone actually thinks this is a good idea.
                            serverURLInfo = UrlFlexParser.parseAndFixURLParts(requestParts.listenPath);
                            serverURLInfo = {
                                url: serverURLInfo.hostname + serverURLInfo.path,
                                protocol: requestParts.protocol,
                                hostname: serverURLInfo.hostname,
                                path: serverURLInfo.path,
                                port: serverURLInfo.port,
                                rate: 0,
                                rateLimitPeriod: 0
                            };
                            processValidatedRequest(requestParts, serverURLInfo, referrer, request, response);
                        } else {
                            sendErrorResponse(request.url, response, 404, 'Resource ' + request.url + ' not found.');
                        }
                    } else {
                        sendErrorResponse(request.url, response, 403, rejectionReason);
                    }
                }
            } else {
                sendErrorResponse(request.url, response, 403, 'referrer "' + referrer + '" not allowed.');
            }
        }
    } else {
        sendErrorResponse(request.url, response, 403, 'Invalid request: could not parse request as a valid request.');
    }
}

/**
 * Run the server. This function never returns. You have to kill the process, such as ^C.
 * All connection requests are forwarded to processRequest(q, r).
 */
function startServer () {
    var httpsOptions,
        proxyServerOptions = {};

    serverStartTime = new Date();
    QuickLogger.logInfoEvent("Starting " + (configuration.useHTTPS ? 'HTTPS' : 'HTTP') + " server on port " + configuration.port + " -- " + serverStartTime.toLocaleString());

    // The RateMeter depends on the configuration.serverUrls being valid.
    rateMeter = RateMeter(configuration.serverUrls, configuration.allowedReferrers, QuickLogger.logErrorEvent.bind(QuickLogger));
    rateMeter.start();

    // If we are to run an https server we need to load the certificate and the key
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

        if (waitingToRunIntegrationTests) {
            __runIntegrationTests();
        }

        httpServer.listen(configuration.port);
    }
}

/**
 * Perform any actions when the app is terminated.
 * @param options
 * @param error
 */
function exitHandler (options, error) {
    QuickLogger.logEventImmediately(QuickLogger.LOGLEVEL.INFO.value, 'Stopping server via ' + options.reason);
    if (rateMeter != null) {
        rateMeter.stop();
        rateMeter = null;
    }
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

/**
 * Set up the node process exit handlers and any other node integration we require.
 * @param process
 */
function configProcessHandlers(process) {
    process.stdin.resume(); // so the program will not close instantly

    // Set handler for app shutdown event
    process.on('exit', exitHandler.bind(null, {reason: "normal exit"}));
    process.on('SIGINT', exitHandler.bind(null, {exit: true, reason: "app terminated via SIGINT"}));
    process.on('uncaughtException', exitHandler.bind(null, {exit: true, reason: "uncaught exception"}));
}

/**
 * Run any tests that require our server is up and running. Waits for the server to be up and running
 * before scheduling the tests.
 */
function runIntegrationTests() {
    if (configurationComplete) {
        __runIntegrationTests();
    } else {
        waitingToRunIntegrationTests = true;
    }
}

function __runIntegrationTests() {
    var testStr;
    var targetStr;
    var result;

    waitingToRunIntegrationTests = false;

    console.log("TTTTT Starting integration tests ");

    QuickLogger.logInfoEvent('This is an Info level event');
    QuickLogger.logWarnEvent('This is a Warning level event');
    QuickLogger.logErrorEvent('This is an Error level event');

    testStr = '/proxy/geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy/http/geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy/https/geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy/*/geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy?geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy?http/geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy?http://geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy&geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy&http/geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '/proxy&http://geo.arcgis.com/ArcGIS/rest/info/';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '';
    result = UrlFlexParser.parseURLRequest(testStr, configuration.listenURI);
    console.log('parseURLRequest url=' + testStr + ' result=' + JSON.stringify(result));


    testStr = "server.gateway.com"; // should match *.gateway.com
    targetStr = UrlFlexParser.validatedReferrerFromReferrer(testStr, configuration.allowedReferrers);
    console.log('validatedReferrerFromReferrer referrer=' + testStr + ' result=' + targetStr);

    testStr = "www.gateway.com"; // should match *.gateway.com
    targetStr = UrlFlexParser.validatedReferrerFromReferrer(testStr, configuration.allowedReferrers);
    console.log('validatedReferrerFromReferrer referrer=' + testStr + ' result=' + targetStr);

    testStr = "https://www.customer.com/gateway"; // should match www.customer.com
    targetStr = UrlFlexParser.validatedReferrerFromReferrer(testStr, configuration.allowedReferrers);
    console.log('validatedReferrerFromReferrer referrer=' + testStr + ' result=' + targetStr);

    testStr = "https://www.brindle.com/gateway"; // should match *://*/gateway
    targetStr = UrlFlexParser.validatedReferrerFromReferrer(testStr, configuration.allowedReferrers);
    console.log('validatedReferrerFromReferrer referrer=' + testStr + ' result=' + targetStr);

    testStr = "https://www.esri.com/1/2/3"; // should match https://*
    targetStr = UrlFlexParser.validatedReferrerFromReferrer(testStr, configuration.allowedReferrers);
    console.log('validatedReferrerFromReferrer referrer=' + testStr + ' result=' + targetStr);

    testStr = "http://www.esri.com/1/2/3"; // should NOT match https://*
    targetStr = UrlFlexParser.validatedReferrerFromReferrer(testStr, configuration.allowedReferrers);
    console.log('validatedReferrerFromReferrer referrer=' + testStr + ' result=' + targetStr);

    testStr = "*"; // should not match anything
    targetStr = UrlFlexParser.validatedReferrerFromReferrer(testStr, configuration.allowedReferrers);
    console.log('validatedReferrerFromReferrer referrer=' + testStr + ' result=' + targetStr);


    console.log("TTTTT Completed integration tests ");
}

function loadConfigThenStart() {
    configProcessHandlers(process);
    loadConfigurationFile();
}

exports.ArcGISProxyStart = loadConfigThenStart;
exports.ArcGISProxyIntegrationTest = runIntegrationTests;

loadConfigThenStart();
