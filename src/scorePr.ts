import * as core from '@actions/core'

import {AverageCoverage, FilesCoverage} from './coverage'
import {formatAverageTable, formatFilesTable, toPercent} from './format'
import {context} from '@actions/github'
import {octokit} from './client'

const TITLE = `☂️ Python Coverage`

export type PublishType = 'check' | 'comment'

export async function publishMessage(pr: number, message: string): Promise<void> {
  const body = `#${TITLE.concat(message)}`
  core.summary.addRaw(body).write()

  const comments = await octokit.rest.issues.listComments({
    ...context.repo,
    issue_number: pr
  })
  const exist = comments.data.find(commnet => {
    return commnet.body?.startsWith(TITLE)
  })

  if (exist) {
    await octokit.rest.issues.updateComment({
      ...context.repo,
      issue_number: pr,
      comment_id: exist.id,
      body
    })
  } else {
    await octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: pr,
      body
    })
  }
}

export async function publishGithubCheck(
  message: string,
  passOverall: boolean,
  cover: AverageCoverage,
  title: string
): Promise<void> {
  const head_sha = context.payload.pull_request?.head.sha
  if (!head_sha) {
    core.error('No head SHA found. Cannot create a check.')
    return
  }

  const conclusion = passOverall ? 'success' : 'failure'

  core.info('Publishing Github check...')

  await octokit.rest.checks.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    name: title,
    head_sha,
    status: 'completed',
    conclusion,

    output: {
      title: passOverall ? 'Coverage passed' : 'Coverage failed',
      summary: `Coverage ${cover.covered} / ${toPercent(cover.threshold)}`,
      text: message
    }
  })
}

export function scorePr(filesCover: FilesCoverage, publishType: PublishType): boolean {
  let message = ''
  let passOverall = true
  core.info(`Publishing results as ${publishType}...`)

  core.startGroup('Results')
  const {coverTable: avgCoverTable, pass: passTotal} = formatAverageTable(filesCover.averageCover)
  message = message.concat(`\n## Overall Coverage\n${avgCoverTable}`)
  passOverall = passOverall && passTotal
  const coverAll = toPercent(filesCover.averageCover.ratio)
  passTotal ? core.info(`Average coverage ${coverAll} ✅`) : core.error(`Average coverage ${coverAll} ❌`)

  if (filesCover.newCover?.length) {
    const {coverTable, pass: passNew} = formatFilesTable(filesCover.newCover)
    passOverall = passOverall && passNew
    message = message.concat(`\n## New Files\n${coverTable}`)
    passNew ? core.info('New files coverage ✅') : core.error('New Files coverage ❌')
  } else {
    message = message.concat(`\n## New Files\nNo new covered files...`)
    core.info('No covered new files in this PR ')
  }

  if (filesCover.modifiedCover?.length) {
    const {coverTable, pass: passModified} = formatFilesTable(filesCover.modifiedCover)
    passOverall = passOverall && passModified
    message = message.concat(`\n## Modified Files\n${coverTable}`)
    passModified ? core.info('Modified files coverage ✅') : core.error('Modified Files coverage ❌')
  } else {
    message = message.concat(`\n## Modified Files\nNo covered modified files...`)
    core.info('No covered modified files in this PR ')
  }
  const sha = context.payload.pull_request?.head.sha.slice(0, 7)
  const action = '[action](https://github.com/marketplace/actions/python-coverage)'
  message = message.concat(`\n\n\n> **updated for commit: \`${sha}\` by ${action}🐍**`)
  message = `\n> current status: ${passOverall ? '✅' : '❌'}`.concat(message)

  switch (publishType) {
    case 'comment':
      publishMessage(context.issue.number, message)
      break
    case 'check':
      publishGithubCheck(message, passOverall, filesCover.averageCover, core.getInput('title') || TITLE)
      break
  }
  core.endGroup()

  return passOverall
}
