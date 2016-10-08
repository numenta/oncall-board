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

This is a very skinny server. It exposes an interface to create status indicators. You can add a new indicator like this:

```javascript
statusFetchers.push(function(callback) {
    callback({
         name: "this will be displayed on the status board as the title of this report"
       , status: "success,failure,error,pending,unknown"
       , description: "a more detailed description, as long as you want i guess"
       , link: "a url to more details"
       , category: "choose one from options in `categories` in oncall-board.js"
     });
});
```

The function must call the callback with a status object described above.
