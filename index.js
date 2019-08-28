const get = require("lodash/get");
const sortBy = require("lodash/sortBy");

const STAGING_BRANCH = "staging";
const MASTER_BRANCH = "master";
const OWNER = "jeffreysnell";

const TABLE_HEADER = `| SHA | User | Commit message | \n|:---|:---|:---|\n`;

const TITLE_KEY = "Production Deploy (deploy-bot):";
const TITLE_TEMPLATE = (date = new Date()) => TITLE_KEY + " " + date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
});


const getRef = (context) => get(context, "payload.ref") ||
    get(context, "payload.head.ref") ||
    get(context, "payload.pull_request.base.ref", "");

const getRepo = (context) => get(context, "payload.repository.name", "");
const isStaging = context => getRef(context).includes(STAGING_BRANCH);
const defaultParams = context => ({
    owner: OWNER,
    repo: getRepo(context)
});

const getBotPrs = async (context) => {
    const pullRequests = await context.github.pullRequests.list({
        ...defaultParams(context),
        base: MASTER_BRANCH
    });

    const botPrs = get(pullRequests, "data", []).filter(pullRequest => pullRequest.title && pullRequest.title.includes(TITLE_KEY));
    return sortBy(botPrs, pr => -new Date(pr.created_at));
};

const getPRCommits = async (context, pr) => {

    const commits = await context.github.pullRequests.listCommits({
        ...defaultParams(context),
        number: pr.number
    });
    return commits;
};

const createBotPR = async (app, context) => {
    app.log("Opening an empty deploy PR");
    const deployPr = await context.github.pullRequests.create({
        ...defaultParams(context),
        title: TITLE_TEMPLATE(new Date()),
        base: MASTER_BRANCH,
        head: STAGING_BRANCH

    });
    return updateBotPr(app, context, deployPr.data);
};

const updateBotPr = async (app, context, pr) => {
    const commits = await getPRCommits(context, pr);
    if (commits.data.length) {
        let table = TABLE_HEADER;
        table += commits.data.map(commit => {
            const sha = commit.sha.substr(0, 10);
            const user = get(commit, "author.login", "");
            const message = get(commit, "commit.message", "").substr(0, 80).replace(/[|\n]/g, " ");
            return `| ${sha} | ${user} | ${message} |`;
        }).join('\n');
        app.log(table);
        return await context.github.pullRequests.update({
            ...defaultParams(context),
            pull_number: pr.number,
            number: pr.number,
            body: table
        });
    }

    return pr;
};

const createOrUpdateBotPr = async (app, context) => {
    const botPrs = await getBotPrs(context);

    if (botPrs.length === 0) {
        return createBotPR(app, context);
    } else {
        return Promise.all(botPrs.map(pr => updateBotPr(app, context, pr)));
    }
};

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
module.exports = app => {
    // Your code here
    app.log('Yay, the app was loaded!');

    app.on('issues.opened', async context => {
        const issueComment = context.issue({ body: 'Thanks for opening this issue!' });
        return context.github.issues.createComment(issueComment);
    });

    app.on('push', async context => {
        if (!isStaging(context)) {
            app.log("This is not the staging branch");
            return;
        }
        return createOrUpdateBotPr(app, context);
    });

    app.on(['pull_request.closed'], async (context) => {
        if (!isStaging(context)) {
            app.log("PR does not target the staging branch");
            return;
        }
        return createOrUpdateBotPr(app, context);
    });
    app.on(['pull_request.synchronize'], async (context) => {
        if (!isStaging(context)) {
            app.log("This is not the staging branch");
            return;
        }

        const botPrs = await getBotPrs(context);
        return Promise.all(botPrs.map(pr => updateBotPr(app, context, pr)));
    });

    // For more information on building apps:
    // https://probot.github.io/docs/

    // To get your app running against GitHub, see:
    // https://probot.github.io/docs/development/
};
