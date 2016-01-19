var express = require('express');
var board = require('./oncall-board');
var DEFAULT_PORT = 8080;
var port = process.env['PORT'] || DEFAULT_PORT;

var app = express()
    .use('/static', express.static(__dirname + '/static'))
    .use('/favicon.ico', function(req, res) {
        res.sendStatus(404);
    })
    .use('/', board())
    ;

app.listen(port, function() {
    console.log('Ready on port %s.', port);
});
