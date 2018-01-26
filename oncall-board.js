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

// Users must set these environment variables.
var HOST_URL = process.env.HOST_URL;

var BMB_JSON_URL = 'https://ci.numenta.com/rest/api/latest/result';
var BMB_HTML_URL = 'https://ci.numenta.com/browse';
var BAMBOO_PLANS = {
    'NuPIC Bamboo Jobs': [
        'NUP-PY'
      , 'NUP-CORE'
      , 'NUP-REGR'
    ]
  , 'Doc Builds': [
        'NUP-NUPDOCS'
      , 'NUP-COREDOCS'
  ]
  , 'Web Builds': [
      'WEB-COM'
    , 'WEB-ORG'
  ]
};

function toBootStrapClass(status) {
    switch(status) {
        case 'success':
        case 'Successful':
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
            slug: err.message,
            builds: []
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

function processBambooPayload(payload, group) {
    return {
        title: payload.buildResultKey
      , name: payload.planName
      , link: BMB_HTML_URL + '/' + payload.buildResultKey
      , rawStatus: payload.state
      , status: toBootStrapClass(payload.state)
      , description: payload.reasonSummary + ' (' + payload.state + ')'
      , category: group
    };
}

function requestHander(req, res) {
    var fetchers = [];

    // Add all the bamboo plans we want to monitor.
    _.each(BAMBOO_PLANS, function(plans, group) {
        _.each(plans, function(planKey) {
            var jsonUrl = BMB_JSON_URL + '/' + planKey + '/latest.json';
            fetchers.push(function(callback) {
                request.get(jsonUrl, function(err, response, body) {
                    var payload = undefined;
                    if (err || response.statusCode != 200) {
                        console.log(err);
                        console.log(jsonUrl);
                        return errorResponse(
                            new Error(
                                'Bad response (' + err + ') from '
                                + jsonUrl
                            ), res
                        );
                    }
                    try {
                        payload = JSON.parse(body)
                    } catch (parseError) {
                        return errorResponse(parseError, res);
                    }
                    callback(null, processBambooPayload(payload, group));
                });
            });
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
           request.get(url, function(err, response) {
               var rawStatus = 'up';
               var status = 'success';
               if (err || response.statusCode != 200) {
                   rawStatus = 'down';
                   if (response && response.statusCode) {
                       rawStatus += ' (' + response.statusCode + ')';
                   }
                   status = 'failure';
               }
               callback(null, {
                   title: url
                 , link: url
                 , description: rawStatus
                 , rawStatus: rawStatus
                 , status: status
                 , category: 'URL Checks'
               });
           });
       });
    });

    async.parallel(fetchers, function(err, statusReports) {
        if (err) return errorResponse(err, res);
        var overallStatus = getOverallStatus(statusReports);
        var groupedReports = {};

        _.each(statusReports, function(report) {
            var category = report.category;
            if (! groupedReports[category]) {
                groupedReports[category] = {
                    category: category
                  , reports: []
                  , status: undefined
                };
            }
            groupedReports[category].reports.push(report);
        });

        _.each(groupedReports, function(report) {
            report.status = getOverallStatus(report.reports)
        });

        res.end(mainTmpl({
            title: 'Numenta On-Call Status'
          , url: HOST_URL
          , imageUrl: getOpenGraphImage(overallStatus)
          , description: getOpenGraphDescription(overallStatus)
          , reports: groupedReports
        }));
    });

}

module.exports = function() {
    return requestHander;
};
