# node.js proxy server
This is an implementation of the proxy server using node.js as the server. The proxy handles support for:

* Accessing cross domain resources
* Requests that exceed 2048 characters
* Accessing resources secured with token based authentication.
* [OAuth 2.0 app logins](https://developers.arcgis.com/en/authentication).
* Enabling logging
* Both resource and referrer based rate limiting

## Instructions

* Download and unzip the .zip file or clone the repository. You can download [a released version](https://github.com/Esri/resource-proxy/releases) (recommended) or the [most recent daily build](https://github.com/Esri/resource-proxy/archive/master.zip).
* Install the contents of the PHP folder by adding all files into a web directory.
* Edit the proxy.config file in a text editor to set up your [proxy configuration settings](../README.md#proxy-configuration-settings).
* Start the node server from a command line.
* Test that the proxy is installed and available:
```
http://{yourmachine}:{port}/proxy/ping
```
* Test that the proxy is able to forward requests directly in the browser using:
```
http://{yourmachine}:{port}/proxy/http/services.arcgisonline.com/ArcGIS/rest/services/?f=pjson
```

## Folders and Files

The proxy consists of the following files:
* proxy.config: This file contains the [configuration settings for the proxy](../README.md#proxy-configuration-settings). This is where you will define all the resources that will use the proxy.
* proxy.php: The actual proxy application. In most cases you will not need to modify this file.

## Requirements

* node.js version 5.0 or higher (recommended)

### Example Configurations

The node proxy supports JSON configuration.

