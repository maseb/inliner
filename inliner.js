"use strict";


var fs = require('fs'),
    URL = require('url'),
    util = require('util'),
    zlib = require('zlib');

//var EventEmitter = require('events').EventEmitter;

var async = require('async'),
    jsdom = require('jsdom'),
    request = require('request'),
    UglifyJS = require('uglify-js');


module.exports = Inliner;


Inliner.version = require('./package.json').version;

// TODO: turning any of these options on could easily cause thing to break, they should not be users.
Inliner.defaults = {
  uglify: true
  //collapseWhitespace: !true,
  //compressCSS: !true
  //images: !true
};


/** Inliner jobs:
 *  1. get all inline images and base64 encode
 *  2. get all external style sheets and move to inline
 *  3. get all image references in CSS and base64 encode and replace urls
 *  4. get all external scripts and move to inline
 *  5. compress JavaScript
 *  6. compress CSS & support media queries
 *  7. compress HTML (/>\s+</g, '> <');
 * 
 *  FUTURE ITEMS:
 *  - support for @import
 *  - javascript validation - i.e. not throwing errors
 */
function Inliner(url, options, callback) {
  var defaults = Inliner.defaults;

  this.root = url;

  this.requestCache = {};
  this.requestCachePending = {};

  if (typeof options === 'function') {
    callback = options;
    options = {};

  } else if (options === undefined) {
    options = {}
  }

  Object.keys(defaults).forEach(function (key) {
    if (!options[key]) options[key] = defaults[key];
  });

  this.options = options;

  return this.inline(url, callback);
}


var def = Inliner.prototype;


def.version = Inliner.version;


def.inline = function (url, callback) {
  var inliner = this;

  this.get(url, function (error, html) {
    //debugger;

    if (error) return callback && callback(error);

    if (!html) return callback && callback(null, '');

    jsdom.env(html, '', ['http://code.jquery.com/jquery.min.js'], function (errors, window) {
      if (error && errors.length) {
        return callback && callback(errors);
      }

      inliner.window = window;

      // remove jQuery that was included with jsdom
      window.$('script:last').remove();

      var selectors = {
        scripts: 'script',
        styles: 'style, link[rel=stylesheet]'
      };

      // TODO: fix this
      if (inliner.options.images) {
        inliner.images = {};
        selectors.images = 'img';
      }

      var assets = {};

      Object.keys(selectors).forEach(function (type) {
        var selector = selectors[type];

        if (selector) {
          assets[type] = window.$(selector);
        }
      });

      // TODO: fix this
      if (assets.images) assets.images = assets.images.filter(function () {
        return this.src.indexOf('data:') === -1;
      });

      async.parallel(
        [
          inliner.inlineImages.bind(inliner, url, assets.images),
          inliner.inlineStyles.bind(inliner, url, assets.styles),
          inliner.inlineScripts.bind(inliner, url, assets.scripts)
        ],

        function (error) {//debugger;
          if (error) {
            return callback && callback(error);
          }
    
          // manually remove the comments
          removeComments(window.document.documentElement);
    
          // TODO: fix this
          // collapse the white space
          if (inliner.options.collapseWhitespace) {
            // TODO: put white space helper back in
            window.$('pre').html(function (i, html) {
              return html.replace(/\n/g, '~~nl~~'); //.replace(/\s/g, '~~s~~');
            });
    
            window.$('textarea').val(function (i, v) {
              return v.replace(/\n/g, '~~nl~~').replace(/\s/g, '~~s~~');
            });
    
            html = window.document.innerHTML;
            html = html.replace(/\s+/g, ' ').replace(/~~nl~~/g, '\n').replace(/~~s~~/g, ' ');
    
          } else {
            html = window.document.innerHTML;
          }
    
          html = '<!DOCTYPE html>' + html;
    
          if (callback) callback(null, html);
        }
      );
    });
  });
};


// TODO: fix this
def.inlineImages = function (url, images, callback) {
  if (!images || !images.length) {
    if (callback) callback();

    return this;
  }

  var inliner = this,
      window = this.window,
      list = window.$.makeArray(images);

  async.forEach(list, function (img, next) {
    var resolvedURL = URL.resolve(url, img.src);

    inliner.get(resolvedURL, {encode: true}, function (error, dataurl) {
      if (error) return next(error);

      if (dataurl) {
        inliner.images[img.src] = dataurl;
      }

      img.src = dataurl;
    });

  }, callback);

  return this;
};


def.inlineStyles = function (url, styles, callback) {
  if (!styles || !styles.length) {
    if (callback) callback();

    return this;
  }

  var inliner = this,
      window = this.window,
      list = window.$.makeArray(styles);

  async.forEach(list, function (elem, next) {
    var linkURL;

    if (elem.tagName === 'STYLE') {
      inliner.getImportCSS(inliner.root, elem.innerHTML, function (error, css, url) {
        if (error) return next(error);

        inliner.getImagesFromCSS(url, css, function (error, css) {
          if (error) return next(error);

          window.$(elem).text(css);
          next();
        });
      });

    } else {
      linkURL = URL.resolve(url, elem.href);

      inliner.get(linkURL, function (error, css) {
        if (error) return next(error);

        inliner.getImagesFromCSS(linkURL, css, function (error, css) {
          if (error) return next(error);

          inliner.getImportCSS(linkURL, css, function (error, css) {
            if (error) return next(error);

            var style = '',
                media = elem.getAttribute('media');
    
            if (media) {
              style = '<style>@media ' + media + '{' + css + '}</style>';
            } else {
              style = '<style>' + css + '</style>';
            }

            window.$(elem).replaceWith(style);
            next();
          });
        });
      });

    }
  }, callback);

  return this;
};


def.inlineScripts = function (url, scripts, callback) {
  if (!scripts || !scripts.length) {
    if (callback) callback();

    return this;
  }

  var inliner = this,
      window = this.window,
      list = window.$.makeArray(scripts);

  async.forEach(list, function (elem, next) {
    var $script = window.$(elem),
        scriptURL = URL.resolve(url, elem.src);
  
    if (
      !elem.src ||
      scriptURL.indexOf('google-analytics.com') !== -1 // ignore google
    ) {
      return next();
    }

    inliner.get(scriptURL, {not: 'text/html'}, function (error, data) {
      if (error) return next(error);
  
      // catches an exception that was being thrown, but script escaping wasn't being caught
      if (data) {
        $script.text(data.replace(/<\/script>/gi, '<\\/script>'));
        //.replace(/\/\/.*$\n/g, ''));
      }

      //$script.before('<!-- ' + scriptURL + ' -->');

      next();
    });      

  }, function (error) {
    // now compress the source JavaScript
    if (!error) scripts.each(function () {
      if (error) return;

      if (this.innerHTML.trim().length === 0) {
        // this is an empty script, so throw it away
        return;
      }

      var $script = window.$(this),
          src = $script.attr('src'),

          // note: not using .innerHTML as this coerses & => &amp;
          orig_code = this.firstChild.nodeValue.
                           replace(/<\/(?=(\s*)script[\/ >])/gi, '<\\/'),
                           //replace(/<\/script>/gi, '<\\/script>'),

          final_code = '';

      // only remove the src if we have a script body
      if (orig_code) { 
        $script.removeAttr('src');
      }

      // don't compress already minified code
      if(
        inliner.options.uglify &&
        !(/\bmin\b/).test(src) &&
        !(/google-analytics/).test(src)
      ) {

        try {
          var ast = UglifyJS.parse(orig_code), // parse code and get the initial AST
              compressor = new UglifyJS.Compressor(); 

          // get an AST with compression optimizations
          ast.figure_out_scope();
          ast = ast.transform(compressor);

          // get a new AST with mangled names
          ast.figure_out_scope();
          ast.compute_char_frequency();
          ast.mangle_names();

          final_code = ast.print_to_string();

          // some protection against putting script tags in the body
          window.$(this).text(final_code).append('\n');

        } catch (err) {
          error = err;
        }

      } else if (orig_code) {
        window.$(this).text(orig_code);
        //this.innerText = orig_code;
      }
    });

    if (callback) callback(error);
  });

  return this;
};


def.get = function (url, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // if we've cached this request in the past, just return the cached content
  if (this.requestCache[url]) {
    if (callback) callback(null, this.requestCache[url]);

    return this;
  }

  if (this.requestCachePending[url]) {
    this.requestCachePending[url].push(callback);

    return this;
  }

  this.requestCachePending[url] = [callback];

  var inliner = this;

  function finish (body) {
    inliner.requestCache[url] = body;

    inliner.requestCachePending[url].forEach(function (callback, i) {
      if (callback) callback(null, body);
    });
  }

  fs.exists(url, function (exists) {
    if (exists) {
      fs.readFile(url, 'utf8', function (error, body) {
        if (error) return callback && callback(error);

        finish(body);
      });

    // otherwise continue and create a new web request
    } else {
      request(url, function (error, response, body) {
        if (error) return callback && callback(error);

        var headers = response.headers,
            content_encoding = headers['content-encoding'];

        content_encoding = headers['Content-Encoding'] || headers['Content-encoding'];

        if (content_encoding === 'gzip') {
          zlib.gunzip(new Buffer(body), function (error, result) {
            if (error) return callback && callback(error);

            handleResponseBody(result);
          });

        } else {
          handleResponseBody(body);
        }

        function handleResponseBody (body) {
          body = body.toString('utf8');

          if (response.statusCode !== 200) {
            body = '';

          } else {
            if (options && options.not) {
              if (headers['content-type'].indexOf(options.not) !== -1) {
                body = '';
              }
            }

            if (options.encode && response.statusCode == 200) {
              body = 'data:' + response.headers['content-type'] + ';base64,' + new Buffer(body, 'binary').toString('base64');
            }
          }

          finish(body);
        }
      }); 
    }
  });

  return this;
};


def.getImagesFromCSS = function (rooturl, rawCSS, callback) {
  if (!this.options.images) {
    if (callback) callback(null, rawCSS);

    return this;
  }
  
  var inliner = this,
      images = {},
      urlMatch = /url\((?:['"]*)(?!['"]*data:)(.*?)(?:['"]*)\)/g,
      singleURLMatch = /url\(\s*(?:['"]*)(?!['"]*data:)(.*?)(?:['"]*)\s*\)/,
      matches = rawCSS.match(urlMatch);

  if (!matches.length) {
    if (callback) callback(null, rawCSS);

    return this;
  }

  async.forEach(matches, function (url, next) {
    url = url.match(singleURLMatch)[1];

      var resolvedURL = URL.resolve(rooturl, url);

      if (images[url] === undefined) {
        inliner.get(resolvedURL, { encode: true }, function (error, dataurl) {
          if (error) return next(error);

          if (images[url] === undefined) images[url] = dataurl;

          next();
        });

      } else {
        next();
      }

  }, function (error) {
    if (!callback) return;

    if (error) return callback(error);

    callback(null, rawCSS.replace(urlMatch, function (m, url) {
      return 'url(' + images[url] + ')';
    }));
  });

  return this;
};


def.getImportCSS = function (rooturl, css, callback) {
  var position = css.indexOf('@import'),
      inliner = this;

  if (position !== -1) {
    var match = css.match(/@import\s*(.*)/);

    if (match !== null && match.length) {
      var url = match[1].
        replace(/url/, '').
        replace(/['}"]/g, '').
        replace(/;/, '').
        trim().
        split(' '); // clean up

      // if url has a length > 1, then we have media types to target
      var resolvedURL = URL.resolve(rooturl, url[0]);

      inliner.get(resolvedURL, function (importedCSS) {
        if (url.length > 1) {
          url.shift();
          importedCSS = '@media ' + url.join(' ') + '{' + importedCSS + '}';
        }
        
        css = css.replace(match[0], importedCSS);

        inliner.getImportCSS(rooturl, css, callback);
      });          
    }

  } else {
    // TODO: fix this
    if (inliner.options.compressCSS) css = compressCSS(css);

    callback(null, css, rooturl);
  }
};


function compressCSS(css) {
  return css.
    replace(/\s+/g, ' ').
    replace(/:\s+/g, ':').
    replace(/\/\*.*?\*\//g, '').
    replace(/\} /g, '}').
    replace(/ \{/g, '{').
    //.replace(/\{ /g, '{').
    replace(/; /g, ';').
    replace(/\n+/g, '');
}


function removeComments(element) {
  if (!element || !element.childNodes) return;

  var nodes = element.childNodes,
      i = nodes.length;
  
  while (i--) {
    if (nodes[i].nodeName === '#comment' && nodes[i].nodeValue.indexOf('[') !== 0) {
      element.removeChild(nodes[i]);
    }

    removeComments(nodes[i]);
  }
}


// if this module isn't being included in a larger app, defer to the 
// bin/inliner for the help options
if (!module.parent) require('./bin/inliner');
