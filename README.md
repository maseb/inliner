# Inliner2

Based on [Inliner](http://github.com/remy/inliner) by [Remy Sharp](http://github.com/remy)

## Installation

    $ npm install inliner2

## Usage

    var Inliner = require('inliner2');

    new Inliner('http://remysharp.com', function (error, html) {
      // compressed and inlined HTML page
      console.log(html);
    });
  