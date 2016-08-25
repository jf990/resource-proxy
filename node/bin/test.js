/**
 * Project unit test suite. Created on 8/5/16.
 */

const QuickLogger = require('./QuickLogger');
const ProjectUtilities = require('./ProjectUtilities');
const UrlFlexParser = require('./UrlFlexParser');
const ProxyJS = require('./proxy');


function unitTests () {
    var testStr,
        targetStr,
        result;

    console.log('TTTTT Local unit tests start:');

    testStr = 'http://server.com/application1';
    targetStr = 'http://';
    result = ProjectUtilities.startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'https://';
    result = ProjectUtilities.startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = '';
    result = ProjectUtilities.startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '';
    targetStr = '';
    result = ProjectUtilities.startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '';
    targetStr = 'http://';
    result = ProjectUtilities.startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://server.com/application1';
    result = ProjectUtilities.startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://server.com/application1-xxx';
    result = ProjectUtilities.startsWith(testStr, targetStr);
    console.log('startsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));


    testStr = 'http://server.com/application1';
    targetStr = 'http://';
    result = ProjectUtilities.endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'on1';
    result = ProjectUtilities.endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = '';
    result = ProjectUtilities.endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '';
    targetStr = 'http:';
    result = ProjectUtilities.endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http://server.com/application1';
    targetStr = 'http://server.com/application1';
    result = ProjectUtilities.endsWith(testStr, targetStr);
    console.log('endsWith subject=' + testStr + ' needle=' + targetStr + ' result=' + (result ? 'true' : 'false'));


    result = ProjectUtilities.formatMillisecondsToHHMMSS(new Date());
    console.log('formatMillisecondsToHHMMSS result=' + result);


    var configuration = {
        mustMatch: true,
        useHTTPS: true,
        basePath: '/1/2/3/index.html'
    };

    targetStr = 'mustMatch';
    result = ProjectUtilities.isPropertySet(configuration, targetStr);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result ? 'true' : 'false'));

    targetStr = 'xyz';
    result = ProjectUtilities.isPropertySet(configuration, targetStr);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result ? 'true' : 'false'));

    targetStr = 'useHttps';
    result = ProjectUtilities.isPropertySet(configuration, targetStr);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result ? 'true' : 'false'));

    targetStr = 'useHTTPS';
    result = ProjectUtilities.isPropertySet(configuration, targetStr);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result ? 'true' : 'false'));

    targetStr = 'basePath';
    result = ProjectUtilities.isPropertySet(configuration, targetStr);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result ? 'true' : 'false'));


    targetStr = 'mustMatch';
    result = ProjectUtilities.getIfPropertySet(configuration, targetStr, null);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result === null ? 'null' : result));

    targetStr = 'xyz';
    result = ProjectUtilities.getIfPropertySet(configuration, targetStr, null);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result === null ? 'null' : result));

    targetStr = 'basePath';
    result = ProjectUtilities.getIfPropertySet(configuration, targetStr, null);
    console.log('isPropertySet(configuration, ' + targetStr + ') result=' + (result === null ? 'null' : result));


    testStr = '*://*.esri.com/';
    result = UrlFlexParser.parseAndFixURLParts(testStr);
    console.log('parseAndFixURLParts url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = 'http://*.esri.com/*';
    result = UrlFlexParser.parseAndFixURLParts(testStr);
    console.log('parseAndFixURLParts url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '*://*/gateway/proxy/this-is-my-key/';
    result = UrlFlexParser.parseAndFixURLParts(testStr);
    console.log('parseAndFixURLParts url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = 'http://www.esri.com/1/2/3?q=123&y=0';
    result = UrlFlexParser.parseAndFixURLParts(testStr);
    console.log('parseAndFixURLParts url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = 'http://developers.arcgis.esri.com/1/2/3/';
    result = UrlFlexParser.parseAndFixURLParts(testStr);
    console.log('parseAndFixURLParts url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = 'https://developers.arcgis.esri.com/1/2/3/';
    result = UrlFlexParser.parseAndFixURLParts(testStr);
    console.log('parseAndFixURLParts url=' + testStr + ' result=' + JSON.stringify(result));

    testStr = '';
    result = UrlFlexParser.parseAndFixURLParts(testStr);
    console.log('parseAndFixURLParts url=' + testStr + ' result=' + JSON.stringify(result));


    testStr = 'www.here.com';
    targetStr = 'xyz';
    result = UrlFlexParser.combinePath(testStr, targetStr);
    console.log('combinePath(' + testStr + ', ' + targetStr + ') result=' + (result === null ? 'null' : result));

    testStr = 'http://www.here.com/';
    targetStr = '/xyz';
    result = UrlFlexParser.combinePath(testStr, targetStr);
    console.log('combinePath(' + testStr + ', ' + targetStr + ') result=' + (result === null ? 'null' : result));

    testStr = 'http://www.here.com////';
    targetStr = '////xyz';
    result = UrlFlexParser.combinePath(testStr, targetStr);
    console.log('combinePath(' + testStr + ', ' + targetStr + ') result=' + (result === null ? 'null' : result));

    testStr = '';
    targetStr = '';
    result = UrlFlexParser.combinePath(testStr, targetStr);
    console.log('combinePath(' + testStr + ', ' + targetStr + ') result=' + (result === null ? 'null' : result));

    testStr = '/';
    targetStr = '/';
    result = UrlFlexParser.combinePath(testStr, targetStr);
    console.log('combinePath(' + testStr + ', ' + targetStr + ') result=' + (result === null ? 'null' : result));

    testStr = null;
    targetStr = null;
    result = UrlFlexParser.combinePath(testStr, targetStr);
    console.log('combinePath(' + testStr + ', ' + targetStr + ') result=' + (result === null ? 'null' : result));


    testStr = 'server.com';
    targetStr = 'server.com';
    result = UrlFlexParser.testDomainsMatch(testStr, targetStr);
    console.log('testDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.server.com';
    targetStr = 'service.server.com';
    result = UrlFlexParser.testDomainsMatch(testStr, targetStr);
    console.log('testDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '*.server.com';
    targetStr = 'www.server.com';
    result = UrlFlexParser.testDomainsMatch(testStr, targetStr);
    console.log('testDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.xyz.server.com';
    targetStr = 'service.xyz.server.com';
    result = UrlFlexParser.testDomainsMatch(testStr, targetStr);
    console.log('testDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.sdjfh.server.com';
    targetStr = 'www.jsadfoij.server.com';
    result = UrlFlexParser.testDomainsMatch(testStr, targetStr);
    console.log('testDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'www.*.server.com';
    targetStr = 'www.jsadfoij.server.com';
    result = UrlFlexParser.testDomainsMatch(testStr, targetStr);
    console.log('testDomainsMatch domain=' + testStr + ' domain=' + targetStr + ' result=' + (result ? 'true' : 'false'));


    testStr = '*';
    targetStr = '*';
    result = UrlFlexParser.testProtocolsMatch(testStr, targetStr);
    console.log('testProtocolsMatch p1=' + testStr + ' p2=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '*';
    targetStr = 'http';
    result = UrlFlexParser.testProtocolsMatch(testStr, targetStr);
    console.log('testProtocolsMatch p1=' + testStr + ' p2=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = '*';
    targetStr = 'https';
    result = UrlFlexParser.testProtocolsMatch(testStr, targetStr);
    console.log('testProtocolsMatch p1=' + testStr + ' p2=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'http';
    targetStr = '*';
    result = UrlFlexParser.testProtocolsMatch(testStr, targetStr);
    console.log('testProtocolsMatch p1=' + testStr + ' p2=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'https';
    targetStr = 'http';
    result = UrlFlexParser.testProtocolsMatch(testStr, targetStr);
    console.log('testProtocolsMatch p1=' + testStr + ' p2=' + targetStr + ' result=' + (result ? 'true' : 'false'));

    testStr = 'file';
    targetStr = 'http';
    result = UrlFlexParser.testProtocolsMatch(testStr, targetStr);
    console.log('testProtocolsMatch p1=' + testStr + ' p2=' + targetStr + ' result=' + (result ? 'true' : 'false'));



    console.log('TTTTT Local unit tests complete:');
}

unitTests();
ProxyJS.ArcGISProxyIntegrationTest(); // <== actually just queues the integration test: it cannot start until after the server is started.
