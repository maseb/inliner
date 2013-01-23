# Inliner2

Based on [Inliner](http://github.com/remy/inliner) by [Remy Sharp](http://github.com/remy)

Turns your web page to a single HTML file with everything inlined - perfect for appcache manifests on mobile devices that you want to reduce those http requests.

## What it does

- Get a list of all the assets required to drive the page: CSS, JavaScript, images and images used in CSS
- Minify JavaScript (via [uglify-js](https://github.com/mishoo/UglifyJS "mishoo/UglifyJS - GitHub"))
- Strips white from CSS
- Base64 encode images
- Puts everything back together as a single HTML file with a simplfied doctype

## Installation

Check out a working copy of the source code with [Git](http://git-scm.com), or install `inliner2` via [npm](http://npmjs.org) (the recommended way).

    $ npm install inliner2 -g
    
Or
    
    $ git clone https://github.com/rolandpoulter/inliner.git
    
`inliner2` uses a `package.json` to describe the dependancies, and if you install via a github clone, ensure you run `npm install` from the `inliner2` directory to install the dependancies.

## Usage

To use inline inside your own script:

    var Inliner = require('inliner2');

    new Inliner('http://remysharp.com', function (error, html) {
      // compressed and inlined HTML page
      console.log(html);
    });

Once you've inlined the crap out of the page, add the `manifest="self.appcache"` to the `html` tag and create an empty file called self.appcache ([read more](http://remysharp.com/2011/01/31/simple-offline-application/)).

## Support

- Collapses all white space in HTML (except inside `<pre>` elements)
- Strips all HTML comments
- Pulls JavaScript and CSS inline to HTML
- Compresses JavaScript via uglify (if not compressed already)
- Converts all images to based64 data urls, both inline images and CSS images
- Imports all @import rules from CSS (recusively)
- Applies media query rules (for print, tv, etc media types)
- Leaves conditional comments in place
- If JavaScript can't be imported (or is Google Analytics), source is not put inline

## Limitations / Caveats

- Whitespace compression might get a little heavy handed - all whitespace is collapsed from n spaces to one space.
  