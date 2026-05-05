import * as core from '@actions/core';
import * as github from '@actions/github';

async function run() {
  try {
    const issueCloseMessage: string = core.getInput('issue-close-message');
    const prCloseMessage: string = core.getInput('pr-close-message');
    const issueCloseReasonInput: string = core.getInput('issue-close-reason');
    let issueCloseReason: 'not_planned' | 'completed';
    if (issueCloseReasonInput === 'completed') {
      issueCloseReason = 'completed';
    } else {
      if (issueCloseReasonInput && issueCloseReasonInput !== 'not_planned') {
        core.warning(
          `Invalid issue-close-reason "${issueCloseReasonInput}", defaulting to "not_planned". Valid values are "not_planned" or "completed".`
        );
      }
      issueCloseReason = 'not_planned';
    }

    if (!issueCloseMessage && !prCloseMessage) {
      throw new Error(
        'Action must have at least one of issue-close-message or pr-close-message set'
      );
    }

    const issuePattern: string = core.getInput('issue-pattern');
    const prPattern: string = core.getInput('pr-pattern');

    if (!issuePattern && !prPattern) {
      throw new Error(
        'Action must have at least one of issue-pattern or pr-pattern set'
      );
    }

    // Get client and context
    const client = github.getOctokit(
      core.getInput('repo-token', {required: true})
    );
    const context = github.context;
    const payload = context.payload;

    if (payload.action !== 'opened' && payload.action !== 'edited') {
      core.debug('No issue or PR was opened or edited, skipping');
      return;
    }

    // Do nothing if its not a pr or issue
    const isIssue: boolean = !!payload.issue;

    if (!isIssue && !payload.pull_request) {
      core.debug(
        'The event that triggered this action was not a pull request or issue, skipping.'
      );
      return;
    }

    if (!payload.sender) {
      throw new Error('Internal error, no sender provided by GitHub');
    }

    const issue: {owner: string; repo: string; number: number} = context.issue;
    const patternString: string = isIssue ? issuePattern : prPattern;

    if (!patternString) {
      core.debug('No pattern provided for this type of contribution');
      return;
    }

    const pattern: RegExp = new RegExp(patternString);
    const body: string | undefined = getBody(payload);

    core.debug(`Matching against pattern ${pattern}`);
    if (body && body.match(pattern)) {
      core.debug('Body matched. Nothing more to do.');
      return;
    } else {
      core.debug('Body did not match');
    }

    // Do nothing if no message set for this type of contribution
    const closeMessage: string = isIssue ? issueCloseMessage : prCloseMessage;

    if (!closeMessage) {
      core.debug('No close message template provided for this type of contribution');
      return;
    }

    core.debug('Creating message from template');
    const message: string = evalTemplate(closeMessage, payload)
    const issueType: string = isIssue ? 'issue' : 'pull request';

    // Add a comment to the appropriate place
    core.debug(`Adding message: ${message} to ${issueType} ${issue.number}`);
    if (isIssue) {
      await client.rest.issues.createComment({
        owner: issue.owner,
        repo: issue.repo,
        issue_number: issue.number,
        body: message
      });
      core.debug('Closing issue');
      await client.rest.issues.update({
        owner: issue.owner,
        repo: issue.repo,
        issue_number: issue.number,
        state: 'closed',
        state_reason: issueCloseReason
      });
    } else {
      await client.rest.pulls.createReview({
        owner: issue.owner,
        repo: issue.repo,
        pull_number: issue.number,
        body: message,
        event: 'COMMENT'
      });
      core.debug('Closing PR');
      await client.rest.pulls.update({
        owner: issue.owner,
        repo: issue.repo,
        pull_number: issue.number,
        state: 'closed'
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
    return;
  }
}

function getBody(payload): string | undefined {
  if (payload.issue && payload.issue.body) {
    return payload.issue.body;
  }

  if (payload.pull_request && payload.pull_request.body) {
    return payload.pull_request.body;
  }
}

function evalTemplate(template, params) {
  return Function(...Object.keys(params), `return \`${template}\``)(...Object.values(params));
}

run();
