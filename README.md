# oncall-board
Numenta On-Call engineer board

# Installation

    npm install

# Environment

You must have the following environment variables set:

    JIRA_USERNAME
    JIRA_PASSWORD
    JENKINS_USERNAME
    JENKINS_PASSWORD
    APPVEYOR_API_TOKEN
    GH_USERNAME
    GH_PASSWORD
    PORT [8080 default]

# Running

    npm start
    open http://localhost:${PORT}

# Under the Hood

This is a very skinny server. It exposes an interface to create status indicators, like this:

```javascript
// Travis CI builds to monitor.
_.each({
    'numenta/nupic': 'NuPIC Travis CI',
    'numenta/nupic.core': 'NuPIC Core Travis CI',
    'numenta/nupic.regression': 'NuPIC Regression Tests'
}, function(title, slug) {
    statusFetchers.push(function(callback) {
        var status = {
            name: title,
            link: 'https://travis-ci.org/' + slug,
            category: categories.OS
        };
        getLastTravisMasterBuildState(slug, function(err, state) {
            if (err) {
                status.status = stateToStatus('unknown');
                status.description = 'unknown';
                return callback(null, status);
            }
            status.description = state;
            status.status = stateToStatus(state);
            callback(null, status);
        });
    });
});
```

This snippet shows the configuration objects first, then the function that will process each config object. The function must call the callback with a status object with these keys:

```javascript
{
    name: "this will be displayed on the status board as the title of this report"
  , status: "success,failure,error,pending,unknown"
  , description: "a more detailed description, as long as you want i guess"
  , link: "a url to more details"
  , category: "choose one from options in `categories` in oncall-board.js"
}
```
