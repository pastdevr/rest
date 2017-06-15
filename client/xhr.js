/*
 * Copyright 2012-2016 the original author or authors
 * @license MIT, see LICENSE.txt for details
 *
 * @author Scott Andrews
 */

'use strict'

/* eslint-env browser */

var normalizeHeaderName = require('../util/normalizeHeaderName')
var responsePromise = require('../util/responsePromise')
var client = require('../client')

// according to the spec, the line break is '\r\n', but doesn't hold true in practice
var headerSplitRE = /[\r|\n]+/

function parseHeaders (raw) {
  // Note: Set-Cookie will be removed by the browser
  var headers = {}

  if (!raw) { return headers }

  raw.trim().split(headerSplitRE).forEach(function (header) {
    var boundary = header.indexOf(':')
    var name = normalizeHeaderName(header.substring(0, boundary).trim())
    var value = header.substring(boundary + 1).trim()
    if (headers[name]) {
      if (Array.isArray(headers[name])) {
        // add to an existing array
        headers[name].push(value)
      } else {
        // convert single value to array
        headers[name] = [headers[name], value]
      }
    } else {
      // new, single value
      headers[name] = value
    }
  })

  return headers
}

function safeMixin (target, source) {
  Object.keys(source || {}).forEach(function (prop) {
    // make sure the property already exists as
    // IE 6 will blow up if we add a new prop
    if (source.hasOwnProperty(prop) && prop in target) {
      try {
        target[prop] = source[prop]
      } catch (e) {
        // ignore, expected for some properties at some points in the request lifecycle
      }
    }
  })

  return target
}

module.exports = client(function xhr (request) {
  return responsePromise.promise(function (resolve, reject) {
    request = typeof request === 'string' ? { path: request } : request || {}
    var response = { request: request }

    if (request.canceled) {
      response.error = 'precanceled'
      reject(response)
      return
    }

    var XHR = request.engine || XMLHttpRequest
    if (!XHR) {
      reject({ request: request, error: 'xhr-not-available' })
      return
    }

    var entity = request.entity
    request.method = request.method || (entity ? 'POST' : 'GET')
    var method = request.method
    var url = response.url = request.path || ''

    var client
    try {
      client = response.raw = new XHR()

      // mixin extra request properties before and after opening the request as some properties require being set at different phases of the request
      safeMixin(client, request.mixin)
      client.open(method, url, true)
      safeMixin(client, request.mixin)

      var headers = request.headers
      for (var headerName in headers) {
        if (headerName === 'Content-Type' && headers[headerName] === 'multipart/form-data') {
          // XMLHttpRequest generates its own Content-Type header with the
          // appropriate multipart boundary when sending multipart/form-data.
          continue
        }

        client.setRequestHeader(headerName, headers[headerName])
      }

      request.canceled = false
      request.cancel = function cancel () {
        request.canceled = true
        response.error = 'canceled'
        client.abort()
        reject(response)
      }

      client.onreadystatechange = function (/* e */) {
        if (request.canceled) { return }
        if (client.readyState === (XHR.DONE || 4)) {
          response.status = {
            code: client.status,
            text: client.statusText
          }
          response.headers = parseHeaders(client.getAllResponseHeaders())
          response.entity = client.responseText

          // #125 -- Sometimes IE8-9 uses 1223 instead of 204
          // http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
          if (response.status.code === 1223) {
            response.status.code = 204
          }

          if (response.status.code > 0) {
            // check status code as readystatechange fires before error event
            resolve(response)
          } else {
            // give the error callback a chance to fire before resolving
            // requests for file:// URLs do not have a status code
            setTimeout(function () {
              resolve(response)
            }, 0)
          }
        }
      }

      try {
        client.onerror = function (/* e */) {
          response.error = 'loaderror'
          reject(response)
        }
      } catch (e) {
        // IE 6 will not support error handling
      }

      if (entity === undefined) {
				entity = null;
			}

      client.send(entity)
    } catch (e) {
      response.error = 'loaderror'
      reject(response)
    }
  }, request)
})
