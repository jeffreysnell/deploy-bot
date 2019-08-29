# deploy-bot

> A GitHub App built with [Probot](https://github.com/probot/probot) that A probot app that opens merge PRs from staging to master automatically.
> Check the probot documentation for application setup instructions

This bot monitors your staging branch and master branch and automatically creates PRs and keeps those PRs up to date so that you can merge the content
from staging onto master. 

It includes a table with the contents of the PR, note that by using these shas the 
feature PRs where were merged into your staging branch will be updated
with a reference to this staging->master merge   

| SHA | User | Commit message | 
|:---|:---|:---|
| 048a9b916a | jeffreysnell | Don't need this |
| d21f806157 | jeffreysnell | A commit to test deploy bot |
| db0fd68e07 | jeffreysnell | Adding a change for depoy bot |
| 41054c88fc | jeffreysnell | Merge pull request #11 from jeffreysnell/some-new-branch  Some new branch that I |

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```


##Deploying the bot locally on localhost:3030
```sh
Follow instructions in .env.example to configure the bot and connect
it to github webhooks

npm run dev
```



