var path = require('path');
var fs = require('fs');
var request = require('request');
var async = require('async');
var _ = require('lodash');
var Handlebars = require('handlebars');
var mainTmpl = Handlebars.compile(
    fs.readFileSync(
        path.join(__dirname, 'templates/main.hbt')
    ).toString()
);
var statusFetchers = [];
var CI_STATUS_URL = 'http://nubot.numenta.org/hubot/ci-status';
// var CI_STATUS_URL = 'http://localhost:8080/hubot/ci-status';
var CI_PLATS = {
    'continuous-integration/bamboo': ['Linux']
  , 'continuous-integration/travis-ci/push': ['OS X']
  , 'continuous-integration/appveyor/branch': ['Windows']
};
var HOST_URL = process.env.HOST_URL;

// Set up FIXIE proxying. This is so we can call into AWS for Jenkins/JIRA APIs
// through specific IP addresses set up by Fixie.
console.log("Using FIXIE proxy at %s.", process.env.FIXIE_URL);
proxyRequest = request.defaults({
    'proxy': process.env.FIXIE_URL
});

function toBootStrapClass(status) {
    switch(status) {
        case 'success':
            return 'success';
        case 'pending':
            return 'warning';
        case 'error':
            return 'error';
        default:
            return 'danger';
    }
}

function errorResponse(err, res) {
    res.end(mainTmpl({
        title: 'ERROR getting status!',
        reports: [{
            slug: 'Error message',
            builds: [{
                name: err.message,
                description: ''
            }]
        }]
    }));
}

function getOverallStatus(reports) {
    var status = 'success';
    _.each(reports, function(report) {
        if (report.status !== 'success') {
            status = toBootStrapClass(report.status);
        }
    });
    return status;
}

function urlReportsToBuildStructure(urlReports) {
    var out = {};
    _.each(urlReports, function (report) {
        report.name = report.name.split('//').pop();
        out[report.name] = report;
    });
    return out;
}

function getOpenGraphImage(status) {
    return HOST_URL + '/static/img/' + status + '.png';
}

function getOpenGraphDescription(status) {
    return {
        'success': 'All Numenta services and pipelines are operational.'
      , 'failure': 'There is a test failure or non-operational service.'
      , 'error': 'Error running a service or pipeline job.'
      , 'pending': 'Jobs are currently running, awaiting results.'
    }[status];
}

function requestHander(req, res) {
    var fetchers = [];

    fetchers.push(function(callback) {
        request.get(CI_STATUS_URL, function(err, response, body) {
            if (err) return callback(err);

            var payload, orderedReports = [];

            try {
                payload = JSON.parse(body)
            } catch (parseError) {
                console.log(body);
                return errorResponse(parseError, res);
            }

            _.each(payload, function(buildStatus, slug) {
                buildStatus.slug = slug;
                _.each(buildStatus.builds, function(build, ciPlatform) {
                    var platforms
                      ;
                    if (ciPlatform == 'status') return;
                    platforms = CI_PLATS[ciPlatform].join(',');
                    ciPlatform = ciPlatform.split('/')[1];
                    build.name = platforms + ' (' + ciPlatform + ')';
                    build.description = build.state;
                    build.status = build.state;
                    build.link = build.url;
                });
                buildStatus.status = toBootStrapClass(buildStatus.status);
            });

            orderedReports.push(payload['numenta/nupic.core']);
            orderedReports.push(payload['numenta/nupic']);
            orderedReports.push(payload['numenta/nupic.regression']);
            orderedReports.push(payload['numenta/numenta-apps/taurus']);
            callback(null, orderedReports);
        });
    });

    // URLs we want to monitor.
    _.each([
       'http://numenta.com',
       'http://numenta.org',
       'http://data.numenta.org',
       'http://tooling.numenta.org/status/',
       'https://discourse.numenta.org/'
    ], function(url) {
       fetchers.push(function(callback) {
           var status = {
               name: url,
               link: url
           };
           request.get(url, function(err, response) {
               var state = 'up';
               if (err || response.statusCode != 200) {
                   state = 'down';
               }
               status.description = state;
               status.status = 'failure';
               if (state == 'up') {
                   status.status = 'success';
               }
               callback(null, status);
           });
       });
    });

    async.parallel(fetchers, function(err, results) {
        if (err) return errorResponse(err, res);
        var reports = results[0]
          , urlReports = results.slice(1)
          , urlStatus = getOverallStatus(urlReports)
          , overallStatus
          ;

        reports.push({
            slug: 'Web Resources'
          , status: urlStatus
          , builds: urlReportsToBuildStructure(urlReports)
        });

        overallStatus = getOverallStatus(reports);

        res.end(mainTmpl({
            title: 'Numenta On-Call Status'
          , url: HOST_URL
          , imageUrl: getOpenGraphImage(overallStatus)
          , description: getOpenGraphDescription(overallStatus)
          , reports: reports
        }));
    });

}

module.exports = function() {
    return requestHander;
};
