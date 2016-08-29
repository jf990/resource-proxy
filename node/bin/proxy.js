/**
 * A proxy server built with node.js and tailored to the ArcGIS platform. See README for description
 * of functionality and configuration.
 *
 * John's to-do list:
 * X test hostRedirect test with http://local.arcgis.com:3333/proxy/geo.arcgis.com/ArcGIS/rest/info/
 * * http://route.arcgis.com/arcgis/rest/services/World/ClosestFacility/NAServer/ClosestFacility_World/solveClosestFacility => http://local.arcgis.com:3333/proxy/http/route.arcgis.com/arcgis/rest/services/World/ClosestFacility/NAServer/ClosestFacility_World/solveClosestFacility?f=json
 *
 * * transform application/vnd.ogc.wms_xml to text/xml
 * * Resolving query parameters, combining query parameters from serverURL and request then replacing token
 * * adding token to request without a token
 * * replace token to a request that has a token but we dont want to use it
 * * If proxied request fails due to 499/498, catching that and retry with credentials or refresh token
 * * username/password
 * * tokenServiceUri
 * * oauth, clientId, clientSecret, oauthEndpoint, accessToken
 * * GET making sure all the query parameters are correct
 * * POST
 * * FILES
 */

const proxyVersion = "0.1.3";
const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const fs = require('fs');
const RateMeter = require('./RateMeter');
const ProjectUtilities = require('./ProjectUtilities');
const QuickLogger = require('./QuickLogger');
const UrlFlexParser = require('./UrlFlexParser');
const Configuration = require('./Configuration');


const defaultOAuthEndPoint = 'https://www.arcgis.com/sharing/oauth2/';

var configuration = Configuration.configuration;
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

function getNewTokenIfCredentialsAreSpecified(serverURLInfo, requestUrl) {
    var newToken = null;

    if (serverURLInfo.isAppLogin) {
    //    //OAuth 2.0 mode authentication
    //    //"App Login" - authenticating using client_id and client_secret stored in config
    //    serverURLInfo.OAuth2Endpoint = string.IsNullOrEmpty(serverURLInfo.OAuth2Endpoint) ? DEFAULT_OAUTH : serverURLInfo.OAuth2Endpoint;
    //    if (serverURLInfo.OAuth2Endpoint[serverURLInfo.OAuth2Endpoint.Length - 1] != '/') {
    //        serverURLInfo.OAuth2Endpoint += "/";
    //    }
    //    log(TraceLevel.Info, "Service is secured by " + serverURLInfo.OAuth2Endpoint + ": getting new token...");
    //    var uri = serverURLInfo.OAuth2Endpoint + "token?client_id=" + serverURLInfo.ClientId + "&client_secret=" + serverURLInfo.ClientSecret + "&grant_type=client_credentials&f=json";
    //    var tokenResponse = webResponseToString(doHTTPRequest(uri, "POST"));
    //    token = extractToken(tokenResponse, "token");
    //    if (!string.IsNullOrEmpty(token))
    //        token = exchangePortalTokenForServerToken(token, serverURLInfo);
    } else if (serverURLInfo.isUserLogin) {
    //        // standalone ArcGIS Server/ArcGIS Online token-based authentication
    //
    //        //if a request is already being made to generate a token, just let it go
    //        if (requestUrl.ToLower().Contains("/generatetoken")) {
    //            var tokenResponse = webResponseToString(doHTTPRequest(requestUrl, "POST"));
    //            token = extractToken(tokenResponse, "token");
    //            return token;
    //        }
    //
    //        //lets look for '/rest/' in the requested URL (could be 'rest/services', 'rest/community'...)
    //        if (reqUrl.ToLower().Contains("/rest/"))
    //            infoUrl = requestUrl.Substring(0, requestUrl.IndexOf("/rest/", StringComparison.OrdinalIgnoreCase));
    //
    //        //if we don't find 'rest', lets look for the portal specific 'sharing' instead
    //        else if (reqUrl.ToLower().Contains("/sharing/")) {
    //            infoUrl = requestUrl.Substring(0, requestUrl.IndexOf("/sharing/", StringComparison.OrdinalIgnoreCase));
    //            infoUrl = infoUrl + "/sharing";
    //        }
    //        else
    //            throw new ApplicationException("Unable to determine the correct URL to request a token to access private resources.");
    //
    //        if (infoUrl != "") {
    //            log(TraceLevel.Info," Querying security endpoint...");
    //            infoUrl += "/rest/info?f=json";
    //            //lets send a request to try and determine the URL of a token generator
    //            string infoResponse = webResponseToString(doHTTPRequest(infoUrl, "GET"));
    //            String tokenServiceUri = getJsonValue(infoResponse, "tokenServicesUrl");
    //            if (string.IsNullOrEmpty(tokenServiceUri)) {
    //                string owningSystemUrl = getJsonValue(infoResponse, "owningSystemUrl");
    //                if (!string.IsNullOrEmpty(owningSystemUrl)) {
    //                    tokenServiceUri = owningSystemUrl + "/sharing/generateToken";
    //                }
    //            }
    //            if (tokenServiceUri != "") {
    //                log(TraceLevel.Info," Service is secured by " + tokenServiceUri + ": getting new token...");
    //                string uri = tokenServiceUri + "?f=json&request=getToken&referer=" + PROXY_REFERER + "&expiration=60&username=" + serverURLInfo.Username + "&password=" + serverURLInfo.Password;
    //                string tokenResponse = webResponseToString(doHTTPRequest(uri, "POST"));
    //                token = extractToken(tokenResponse, "token");
    //            }
    //        }
    //    }
    }
    return newToken;
}

function exchangePortalTokenForServerToken(portalToken, serverURLInfo) {
    // ideally, we should POST the token request
    var parameters = {
        token: portalToken,
        serverURL: serverURLInfo.url,
        f: "json"
    };
    var uri = serverURLInfo.oauth2endpoint.replace('/oauth2', '/generateToken');
    var tokenResponse = webResponseToString(doHTTPRequest(uri, "GET"));
    return ProjectUtilities.findTokenInString(tokenResponse, 'token');
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
            if (serverURLInfo.isHostRedirect) {
                // Host Redirect means we want to replace the host used in the request with a different host, but keep
                // everything else received in the request (path, query).
                parsedHostRedirect = serverURLInfo.parsedHostRedirect;
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

            // TODO: IFF a token based request we should check if the toekn we have is any good and if not generate a new token

            // TODO: Not really sure this worked if the proxy generates an error as we are not catching any error from the proxied service
            validProcessedRequests ++;
            QuickLogger.logInfoEvent("Issuing proxy request [" + request.method + "](" + request.url + ") for " + proxyRequest);
            proxyServer.web(request, response, {
                target: proxyRequest,
                ignorePath: true
            }, proxyResponseError);
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
        referrer;

    attemptedRequests ++;
    if (requestParts != null) {
        referrer = request.headers['referer'];
        if (referrer == null || referrer.length < 1) {
            referrer = '*';
        } else {
            referrer = referrer.toLowerCase().trim();
        }
        QuickLogger.logInfoEvent('---- New request from ' + referrer + ' for ' + requestParts.proxyPath + ' ----');
        if (requestParts.listenPath == configuration.localPingURL) {
            sendPingResponse(referrer, response);
        } else {
            referrer = UrlFlexParser.validatedReferrerFromReferrer(referrer, configuration.allowedReferrers);
            if (referrer != null) {
                if (requestParts.listenPath == configuration.localStatusURL) {
                    sendStatusResponse(referrer, response);
                } else {
                    rejectionReason = isValidURLRequest(requestParts.proxyPath);
                    if (rejectionReason == '') {
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
 * If the proxy target responds with an error we catch it here.
 * @param error
 */
function proxyResponseError(error, proxyRequest, proxyResponse, proxyTarget) {
    QuickLogger.logErrorEvent('proxyResponseError caught error ' + error.code + ': ' + error.description + ' on ' + proxyTarget + ' status=' + proxyResponse.status);
}

/**
 * If the proxy target responds with an error we catch it here. I believe this is only for socket errors
 * as I have yet to catch any errors here.
 * @param proxyError
 */
function proxyErrorHandler(proxyError, proxyRequest, proxyResponse) {
    sendErrorResponse(proxyRequest.url, proxyResponse, 500, 'Proxy error ' + proxyError.toString());
}

/**
 * The proxy service gives us a change to alter the request before forwarding it to the proxied server.
 * @param proxyReq
 * @param proxyRequest
 * @param proxyResponse
 * @param options
 */
function proxyRequestRewrite(proxyReq, proxyRequest, proxyResponse, options) {
    QuickLogger.logInfoEvent("proxyRequestRewrite opportunity to alt request before contacting service.");
}
/**
 * The proxy service gives us a chance to alter the response before sending it back to the client.
 * @param proxyRes
 * @param proxyRequest
 * @param proxyResponse
 * @param options
 */
function proxyResponseRewrite(proxyRes, proxyRequest, proxyResponse, options) {
    // TODO: Read the stream and see if we get error 498/499. if so we need to generate a token.
    if (proxyRes.headers['content-type'] !== undefined) {
        var lookFor = 'application/vnd.ogc.wms_xml';
        var replaceWith = 'text/xml';
        proxyRes.headers['content-type'] = proxyRes.headers['content-type'].replace(lookFor, replaceWith);
    }
    QuickLogger.logInfoEvent("proxyResponseRewrite opportunity to alt response before writing it.");
}

/**
 * Run the server. This function never returns. You have to kill the process, such as ^C or kill.
 * All connection requests are forwarded to processRequest(q, r).
 */
function startServer () {
    var httpsOptions,
        proxyServerOptions = {};

    UrlFlexParser.setConfiguration(configuration);
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
        proxyServer.on('error', proxyErrorHandler);
        proxyServer.on('proxyReq', proxyRequestRewrite);
        proxyServer.on('proxyRes', proxyResponseRewrite);

        if (waitingToRunIntegrationTests) {
            __runIntegrationTests();
        }

        httpServer.listen(configuration.port);
    }
}

/**
 * When loading the configuration fails we end up here with a reason message. We terminate the app.
 * @param reason {Error} hopefully a message indicating why the configuration failed.
 */
function cannotStartServer(reason) {
    QuickLogger.logErrorEvent("!!! Server not started due to invalid configuration. " + reason.message);
    process.exit();
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
 * before scheduling the tests. These tests are here because the functions were not exported and not
 * accessible to the unit/integration test object.
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

    console.log("TTTTT Starting ProxyJS integration tests ");

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


    console.log("TTTTT Completed ProxyJS integration tests ");
}

function loadConfigThenStart() {
    configProcessHandlers(process);
    Configuration.loadConfigurationFile().then(startServer, cannotStartServer);
}

exports.ArcGISProxyIntegrationTest = runIntegrationTests;

loadConfigThenStart();
