const get = require("lodash/get");
const sortBy = require("lodash/sortBy");
const moment = require("moment");
require("moment-timezone");

const STAGING_BRANCH = process.env.STAGING_BRANCH;
const MASTER_BRANCH = process.env.MASTER_BRANCH;
const OWNER = process.env.OWNER;
const TIMEZONE = process.env.TIMEZONE || "America/Toronto";

const TABLE_HEADER = `| SHA | User | Commit message | \n|:---|:---|:---|\n`;

const TITLE_KEY = "Production Deploy (deploy-bot):";
const TITLE_TEMPLATE = (date = new Date()) => TITLE_KEY + " " + moment(date).tz(TIMEZONE).format("MMMM DD YYYY HH:mm")

/**
 * Get the ref from the payload, only tested with pull and pull_request events
 * @param context
 * @param direction one of base, or head,
 * @returns {*}
 */
const getRef = (context, direction = "base") => get(context, "payload.ref") ||
    get(context, "payload.head.ref") ||
    get(context, `payload.pull_request.${direction}.ref`, "");


/**
 * Is the current context referring to the staging branch?
 * @param context
 * @param direction one of base, or head,
 *                 set to head if you are interested in a pull request/commit/etc going from staging into master
 *                 set to base if you are interested in a pull request/commit/etc going from a branch into staging
 *
 * @returns {*}
 */
const isStaging = (context, direction) => getRef(context, direction).includes(STAGING_BRANCH);

/**
 * Gets the repo name from the context which is required in any api calls.
 * @param context event context from probot
 */
const getRepo = (context) => get(context, "payload.repository.name", "");

/**
 * Gets the owner repo name from the context which is required in any api calls.
 * @param context event context from probot
 * @returns {{owner: *, repo: *}} which are required by all github api calls
 */
const defaultParams = context => ({
    owner: OWNER,
    repo: getRepo(context)
});

/**
 * Gets all open bot prs
 * @param context event context from probot
 * @returns {Promise} A list of OPEN pull requests sorted by date created that the PR bot has created.
 */
const getBotPrs = async (context) => {
    const pullRequests = await context.github.pullRequests.list({
        ...defaultParams(context),
        base: MASTER_BRANCH
    });

    const botPrs = get(pullRequests, "data", []).filter(pullRequest => pullRequest.title && pullRequest.title.includes(TITLE_KEY));
    return sortBy(botPrs, pr => -new Date(pr.created_at));
};

/**
 * Gets the commits for a PR
 * @param context event context from probot
 * @param pr that we want to get the commits for
 * @returns {Promise<Github.Response<Github.PullRequestsListCommitsResponse>>} the commits for the PR
 */
const getPRCommits = async (context, pr) => {
    return await context.github.pullRequests.listCommits({
        ...defaultParams(context),
        number: pr.number
    });
};

/**
 * Creates a new bot PR with the title set to the current date on the STAGING_BRANCH merging to the MASTER_BRANCH
 * and the contents of the PR set to a table with the list of commits.
 * @param app the application reference so that we can use it for logging.
 * @param context the application context for the event that was just fired.
 * @returns {Promise} WI
 */
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

/**
 * Given an existing PR, finds all of the commits for that PR then updates the description of the PR to include
 * a table with these commits. This provides additional links in the closed PRs referencing the deploy which they
 * were a part of.
 * @param app the application reference so that we can use it for logging.
 * @param context the application context for the event that was just fired.
 * @param pr a deploy bot pr that we want to update
 * @returns {Promise} that will complete when the PR has been updated
 */
const updateBotPr = async (app, context, pr) => {
    const commits = await getPRCommits(context, pr);
    if (commits.data.length) {
        let table = TABLE_HEADER;
        table += commits.data.map(commit => {
            const sha = commit.sha.substr(0, 10);
            const user = get(commit, "author.login", "");
            const message = get(commit, "commit.message", "").substr(0, 80).replace(/[|\n\r]/g, " ").trim();
            return `| ${sha} | ${user} | ${message} |`;
        }).join('\n');
        return await context.github.pullRequests.update({
            ...defaultParams(context),
            pull_number: pr.number,
            number: pr.number,
            body: table
        });
    }

    return pr;
};

/**
 * Searches through the PRs on this reop, If the bot PR does not exist then it will create that PR then update
 * the PR so that it contains a table with all of the commits in the PR. If the PR exists the table will just be updated.
 *
 * @param app the application reference so that we can use it for logging.
 * @param context the application context for the event that was just fired.
 * @returns {Promise} Which will be complete when the PR is created and/or updated
 */
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
    app.log('Deploy bot has started! Gonna create so many deploy PRS!!');
    app.log(`Now monitoring changes from  ${STAGING_BRANCH} to ${MASTER_BRANCH} owned by ${OWNER}`);

    app.on('issues.opened', async context => {
        const issueComment = context.issue({ body: 'Thanks for opening this issue!' });
        return context.github.issues.createComment(issueComment);
    });

    app.on('push', async context => {
        //Check if the push that was just made was into staging
        if (!isStaging(context)) {
            app.log("This push was not for the staging branch");
            return;
        }
        return createOrUpdateBotPr(app, context);
    });
    
    app.on(['pull_request.synchronize'], async (context) => {
        //This is called when the list of commits is updated on any pr so we will filter to only staging prs
        if (!isStaging(context, "head")) {
            app.log("This is not the staging branch");
            return;
        }

        //Find all of the bot PRs and update them because staging was just synchronized.
        //Don't create a PR in this case because that would create a race condition with push in some cases.
        const botPrs = await getBotPrs(context);
        return Promise.all(botPrs.map(pr => updateBotPr(app, context, pr)));
    });
};
