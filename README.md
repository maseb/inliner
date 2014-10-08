# Inliner3

Based on [Inliner](http://github.com/remy/inliner) by [Remy Sharp](http://github.com/remy)

## Installation

    $ npm install inliner3

## Usage

    var Inliner = require('inliner3');

    new Inliner('http://remysharp.com', function (error, html) {
      // compressed and inlined HTML page
      console.log(html);
    });
  
