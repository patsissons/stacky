export interface Entry {
  name: string
  what: string
  command?: string
}

/** Plain explanations of what each operation does, grouped as they appear in the UI. */
export const OPERATIONS: { title: string; entries: Entry[] }[] = [
  {
    title: 'Stack actions',
    entries: [
      {
        name: 'Deploy',
        what: 'Checks the compose file, then creates or updates the containers so they match it. Removes containers for services you deleted.',
        command: 'docker compose up -d --remove-orphans',
      },
      {
        name: 'Deploy → Pull images, then deploy',
        what: 'Pulls every image before deploying, so tags like latest move to the newest build.',
        command: 'docker compose up -d --pull always',
      },
      {
        name: 'Deploy → Rebuild images, then deploy',
        what: 'Rebuilds services that have a build: section (Dockerfile) before deploying.',
        command: 'docker compose up -d --build',
      },
      {
        name: 'Deploy → Recreate all containers',
        what: 'Replaces every container even if nothing changed. Useful after changing files a container reads only at start.',
        command: 'docker compose up -d --force-recreate',
      },
      {
        name: 'Update',
        what: 'Applies the newer versions found by Check for updates, after you confirm the list: newer tags are written into the compose file (only the image: lines), then those services are pulled and recreated and dangling images are removed. A stopped stack stays stopped. The button is disabled while no update is known; its menu still has Re-pull current tags, which pulls the tags already in the compose file again.',
        command: 'docker compose pull → up -d → docker image prune',
      },
      {
        name: 'Update → Pull updates only',
        what: 'Downloads the newer versions found by Check for updates, ahead of time. The compose file and the running containers are left alone.',
        command: 'docker pull <image>:<new tag> · docker compose pull <rebuilt services>',
      },
      {
        name: 'Update → Re-pull current tags',
        what: 'Pulls the tags already in the compose file again and recreates the containers whose image changed, even when the stack has newer versions you have not applied.',
        command: 'docker compose pull → up -d → docker image prune',
      },
      {
        name: 'Restart',
        what: 'Restarts the existing containers without recreating them. Compose file changes are not applied; use Deploy for that.',
        command: 'docker compose restart',
      },
      {
        name: 'Stop / Start',
        what: 'Stop halts the containers but keeps them. Start brings the stack up again from its compose file.',
        command: 'docker compose stop · docker compose up -d',
      },
      {
        name: 'More → Pull images only',
        what: 'Pulls the tags already in the compose file again, without touching the running containers. They switch over on the next deploy. For newer versions use Update → Pull updates only.',
        command: 'docker compose pull',
      },
      {
        name: 'More → Down',
        what: 'Stops and removes the containers and networks. Files and named volumes stay, unless you tick the option to remove volumes, which deletes their data.',
        command: 'docker compose down --remove-orphans [--volumes]',
      },
      {
        name: 'More → Delete stack',
        what: 'Takes the stack down, then deletes its directory and every file in it. This cannot be undone.',
      },
    ],
  },
  {
    title: 'Containers and updates',
    entries: [
      {
        name: 'Start / Stop / Restart (one service)',
        what: 'The same as the stack actions, for a single service only.',
        command: 'docker compose up -d --no-deps <service> · stop · restart',
      },
      {
        name: 'Recreate (one service)',
        what: 'Replaces that service’s container with a fresh one from the same image, without touching the rest of the stack.',
        command: 'docker compose up -d --no-deps --force-recreate <service>',
      },
      {
        name: 'Pull & recreate (one service)',
        what: 'Pulls that service’s tag again and recreates it if the image changed. The same as Pull <tag> in the update dialog.',
        command: 'docker compose pull <service> → up -d --no-deps <service>',
      },
      {
        name: 'Check for updates',
        what: 'Asks each image’s registry whether a newer version or a new build of the same tag exists. Nothing is changed. The stack page’s Update menu checks that stack’s images only; a container’s menu (and the telescope in the update dialog) checks that one image only.',
      },
      {
        name: 'Update to <version>',
        what: 'Changes only the service’s image: line in the compose file to the newer tag, then pulls and recreates that service.',
      },
      {
        name: 'Pull <tag>',
        what: 'Pulls the rebuilt image behind the same tag and recreates that service.',
        command: 'docker compose pull <service> → up -d --no-deps <service>',
      },
      {
        name: 'Update all',
        what: 'Applies every available update above after you confirm the list: one Update per stack.',
      },
      {
        name: 'Update all → Pull all updates',
        what: 'Downloads every available update without applying it: one Pull updates only per stack.',
      },
      {
        name: 'Ignore this update',
        what: 'Hides that specific version or digest. The next newer one shows up again. The greyed badge that stays behind opens the same dialog, where Stop ignoring brings it back.',
      },
    ],
  },
  {
    title: 'stacky itself',
    entries: [
      {
        name: 'Update stacky',
        what: 'Pulls the new stacky image, then a short-lived updater container swaps stacky over and rolls back automatically if the new version does not start.',
      },
      {
        name: 'Redeploy / Restart',
        what: 'Applies edits to stacky’s compose file, or recreates its container, through the same updater.',
      },
    ],
  },
]
