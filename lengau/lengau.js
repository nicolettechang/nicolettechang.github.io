// Save your Lengau data, checklist pages (checklist, check, prepare, download, list, tools): fills every
// command box from "Your details" and the download list, keeps the list and the ticks in
// this browser (localStorage), shared by all the pages and kept in step across open tabs.
// The list is changed on its own page (list.html), to keep open next to the guide; every other
// page gets a cart button (the download list) that shows what is on it.
// No network calls, no dependencies.
(function () {
  'use strict';

  var KEY = 'lengau-shutdown-v1';
  var HOST = 'lengau.chpc.ac.za';
  var SAFE = /^[A-Za-z0-9._+\/-]+$/;   // folder paths we can put in a command unquoted
  // leave out: a name (any depth) or a path inside the folder (just that one); wildcards, no quotes or ..
  var SKIP = /^[A-Za-z0-9._+*?\[\]-]+(\/[A-Za-z0-9._+*?\[\]-]+)*$/;
  var GROUP = '/mnt/lustre/groups/erth0834';

  // ---------- state ----------

  var state = {
    user: '', os: 'mac', drive: '', letter: '', drivePath: '', ticks: {}, folders: [], peek: '',
    snap: { kind: 'folders' }, treeMethod: 'rsync'
  };
  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        for (var k in state) if (k in saved) state[k] = saved[k];
      }
    } catch (e) { /* private window or blocked storage: start empty */ }
  }
  load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* not saved, still works */ }
  }

  // ---------- values that go into commands ----------

  var PLACEHOLDER = /YOURUSERNAME|YOURDRIVE|DRIVELETTER|MYFOLDER/;
  function U() { return state.user || 'YOURUSERNAME'; }
  function D() {
    if (state.os === 'win') return '/mnt/' + (state.letter || 'DRIVELETTER').toLowerCase() + '/lengau';
    // the box suggests /Volumes/USBSTICK, so take the name with or without /Volumes/ in front
    var name = state.drive.trim().replace(/^\/?(Volumes\/+)?/, '').replace(/\/+$/, '');
    return '/Volumes/' + (name || 'YOURDRIVE') + '/lengau';
  }
  function awake() { return state.os === 'mac' ? 'caffeinate -i ' : ''; }
  function at() { return U() + '@' + HOST; }
  function scratch() { return '/mnt/lustre/users/' + U(); }
  function tarName(path) { return path.replace(/\/+$/, '').replace(/\//g, '_') + '.tar'; }
  // list items are a folder in scratch (MYCONFIG/X), in the home folder (~/models, or ~ for all of it),
  // or in the group folder (its full path)
  function isHome(f) { return f.path === '~' || f.path.indexOf('~/') === 0; }
  function isGroup(f) { return f.path.indexOf(GROUP + '/') === 0; }
  function rel(f) {
    return f.path === '~' ? '.' : isHome(f) ? f.path.slice(2) : isGroup(f) ? f.path.slice(GROUP.length + 1) : f.path;
  }
  function onDrive(f) {   // home items go under home/, group items under group/
    return isHome(f) ? (f.path === '~' ? 'home' : 'home/' + rel(f)) : isGroup(f) ? 'group/' + rel(f) : f.path;
  }
  function remoteDir(f) { return isHome(f) ? '/home/' + U() : isGroup(f) ? GROUP : scratch(); }
  // tarballs are packed on Lengau in Part 4, into lengau_tars in scratch
  function isTar(f) { return f.method === 'tar' || f.method === 'targz'; }
  function tarFile(f) { return tarName(onDrive(f)) + (f.method === 'targz' ? '.gz' : ''); }
  function skips(f) { return f.skip || []; }
  function parent(path) {
    var p = path.replace(/\/+$/, '');
    var i = p.lastIndexOf('/');
    return i > 0 ? p.slice(0, i) : '';
  }
  function dest(f) { var p = parent(onDrive(f)); return D() + (p ? '/' + p : '') + '/'; }
  var OK = ' && echo "COPIED OK" || echo "FAILED: run it again"';

  var CMDS = {
    'login': function () { return 'ssh ' + at(); },
    'setup': function () { return 'mkdir -p "' + D() + '" && echo "ready: ' + D() + '"'; },
    'size-home': function () { return 'du -sh ~/* ~/.[!.]* 2>/dev/null | sort -h'; },
    'size-scratch': function () { return 'cd /mnt/lustre/users/$USER && du -sh * 2>/dev/null | sort -h'; },
    'size-job': function () {
      return 'cat > ~/sizes.pbs <<"EOF"\n' +
        '#!/bin/bash\n#PBS -N sizes\n#PBS -q serial\n#PBS -P ERTH0834\n' +
        '#PBS -l select=1:ncpus=1\n#PBS -l walltime=04:00:00\n#PBS -j oe\n' +
        'cd /mnt/lustre/users/$USER && du -sh * 2>/dev/null | sort -h > ~/sizes_scratch.txt\n' +
        'EOF\nqsub ~/sizes.pbs';
    },
    'size-read': function () { return 'cat ~/sizes_scratch.txt'; },
    'ex-file': function () { return 'ls -lh myfile.nc'; },
    'ex-dir': function () { return 'du -sh myfolder'; },
    'cd-dir': function () { return 'cd ' + peekDir() + ' && ls -F'; },
    'size-sub': function () { return 'du -sh * .[!.]* 2>/dev/null | sort -h'; },   // run inside the folder cd-dir went to
    'loadmodules': function () {
      return '# an example: load the modules from your own job scripts instead\n' +
        'module load chpc/python/anaconda/3-2021.11\n' +
        'module load chpc/parallel_studio_xe/2020u1';
    },
    'settings': function () {
      return 'S=/mnt/lustre/users/$USER/lengau_settings && mkdir -p $S\n' +
        'module list > $S/modules.txt 2>&1\n' +
        'crontab -l > $S/crontab.txt 2>/dev/null\n' +
        'env | sort > $S/environment.txt\n' +
        'cp -p ~/.bashrc ~/.bash_profile ~/.profile ~/.bash_aliases ~/.bash_history ~/.cshrc ~/.tcshrc ~/.zshrc ~/.inputrc' +
        ' ~/.tmux.conf ~/.screenrc ~/.nanorc ~/.vimrc ~/.emacs ~/.condarc ~/.gitconfig ~/.Rprofile ~/.Renviron $S/ 2>/dev/null\n' +
        'for d in .vim .emacs.d .config/nvim .config/pip .config/matplotlib .ipython/profile_default .jupyter' +
        ' .local/share/jupyter/kernels bin modulefiles; do\n' +
        '  [ -d ~/$d ] && mkdir -p $S/home/$d && cp -rp ~/$d/. $S/home/$d/\n' +
        'done\n' +
        'mkdir -p $S/ssh && cp -p ~/.ssh/config ~/.ssh/*.pub $S/ssh/ 2>/dev/null\n' +
        'command -v python3 > /dev/null && python3 -m pip list --user --format=freeze > $S/pip_user.txt 2>/dev/null\n' +
        'if command -v conda > /dev/null; then\n' +
        '  { command -v conda; conda env list; } > $S/conda_envs.txt\n' +
        "  for p in $(conda env list | awk '!/^#/ && NF {print $NF}'); do\n" +
        '    case "$p" in\n' +
        '      "$HOME"/*|/mnt/lustre/users/"$USER"/*)\n' +
        '        conda env export -p "$p" > $S/conda_env_$(basename "$p").yml\n' +
        '        conda env export -p "$p" --from-history > $S/conda_env_$(basename "$p")_asked_for.yml ;;\n' +
        '    esac\n' +
        '  done\n' +
        'fi\n' +
        '# python virtual environments and git repositories, four folders deep in home and scratch\n' +
        'F=$(find ~ /mnt/lustre/users/$USER -maxdepth 4 \\( -name pyvenv.cfg -o -name .git \\) -not -path "$S/*" 2>/dev/null)\n' +
        'for v in $(echo "$F" | grep "pyvenv.cfg$"); do\n' +
        '  d=$(dirname $v); "$d/bin/python" -m pip freeze > $S/venv_$(basename $d).txt 2>/dev/null\n' +
        'done\n' +
        'for g in $(echo "$F" | grep "/.git$"); do\n' +
        '  r=$(dirname $g)\n' +
        '  echo "$r: $(git -C $r status --porcelain | wc -l) files changed, $(git -C $r log --branches --not --remotes --oneline | wc -l) commits not pushed"\n' +
        'done > $S/git_repos.txt\n' +
        'echo "settings written to $S"; cat $S/git_repos.txt';
    },
    'snap-job': function () { return snapJob(); },
    'snap-log': function () { return 'cat ~/lengau_snapshot.log'; },
    'snap-cd': function () {
      return '# an example: go to the folder that will hold lengau_snapshots\n' +
        (state.os === 'win' ? 'cd /mnt/c/Users/YOURWINDOWSNAME/Documents' : 'cd ~/Documents');
    },
    'snap-get': function () {
      return 'mkdir -p ' + snapDir() + " && scp '" + at() + ":lengau_snapshot_*.tsv.gz' " + snapDir() + '/';
    },
    'snap-group-get': function () {
      return 'mkdir -p ' + snapDir() + " && scp '" + at() + ':' + GROUP_SNAPS + "/group_*.tsv.gz' " + snapDir() + '/';
    },
    'quota': function () { return 'lfs quota -h -u $USER /mnt/lustre'; },
    'tar-job': function () { return tarJob(); },
    'dl-script': function () { return dlScript(); },
    'dl-run': function () { return awake() + 'bash ' + DL_SCRIPT; },
    'dl-log': function () { return 'cat "' + dlLog() + '"'; },
    'tar-wait': function () { return 'qstat -u $USER'; },
    'tar-log': function () { return 'cat ~/make_tars.log'; },
    'nc-kind': function () { return 'ncdump -k myfile.nc'; },
    'nc-modules': function () { return "module avail 2>&1 | grep -i -E 'nco|cdo|netcdf'"; },
    'nc-modload': function () { return "module add chpc/earth/NCO/4.5.5"; },
    'nc-header': function () { return 'ncdump -h myfile.nc'; },
    'nc-extract': function () { return 'ncks -v thetao,so,nav_lat,nav_lon myfile.nc myfile_thetao_so.nc'; },
    'nc-subset': function () { return 'ncks -d time_counter,0,11 myfile.nc myfile_first12.nc'; },
    'nc-monmean': function () { return 'cdo monmean myfile.nc myfile_monthly.nc && cdo showdate myfile_monthly.nc'; },
    'nc-ppc': function () { return 'ncks -7 -L 1 --ppc default=3 myfile.nc myfile_3digits.nc'; },
    'pbs-ijob': function () { return 'qsub -I -q serial -P ERTH0834 -l select=1:ncpus=1 -l walltime=04:00:00'; },
    'nc-interactive-back': function () { return 'cd $PBS_O_WORKDIR && module add chpc/earth/NCO/4.5.5'; },
    'nc-compress': function () {
      return 'nccopy -d 1 -s myfile.nc myfile_small.nc && ncdump -h myfile_small.nc > /dev/null && echo "opens OK"';
    },
    'contents': function () { return 'ls -lR "' + D() + '" > "' + D() + '/CONTENTS.txt" && echo "list written"'; }
  };
  // run on Lengau after logging in; every other command runs on your computer
  // the folder to look inside: a full path, a path from ~, or a name in scratch
  function peekDir() {
    var p = state.peek;
    if (!p) return '/mnt/lustre/users/$USER/MYFOLDER';
    if (p === '~') return '~';
    var q = function (s) { return /\s/.test(s) ? '"' + s + '"' : s; };
    if (p.indexOf('~/') === 0) return '~/' + q(p.slice(2));
    if (p.charAt(0) === '/') return q(p);
    return '/mnt/lustre/users/$USER/' + q(p);
  }
  var ON_LENGAU = { 'snap-job': true, 'snap-log': true, 'ex-file': true, 'ex-dir': true, 'size-home': true, 'size-scratch': true, 'cd-dir': true, 'size-sub': true, 'size-job': true, 'size-read': true,
    'loadmodules': true, 'settings': true, 'quota': true, 'tar-job': true, 'tar-wait': true,
    'tar-log': true, 'nc-kind': true, 'nc-compress': true, 'nc-modules': true, 'nc-header': true,
    'nc-extract': true, 'nc-subset': true, 'nc-monmean': true, 'nc-ppc': true, 'nc-modload': true,
    'pbs-ijob': true, 'nc-interactive-back': true };

  // ---------- snapshot: every folder (or file) with its size, for the tree on the Choose page ----------

  // where the data manager keeps the group folder's snapshots (group_<date>_files.tsv.gz); people copy them
  // from there rather than each listing the group folder again
  var GROUP_SNAPS = GROUP + '/SHARE/snapshots';
  function snapDir() { return 'lengau_snapshots'; }   // made inside whichever folder the snap-cd step went to

  // per folder (default): one line per folder with the files directly in it, added up by awk.
  // per file: one line per file, the same columns as the data manager's inventory.
  function snapJob() {
    var files = state.snap.kind === 'files';
    var roots = '$HOME /mnt/lustre/users/$USER';
    var lines = [
      'cat > ~/lengau_snapshot.pbs <<"EOF"',
      '#!/bin/bash', '#PBS -N snapshot', '#PBS -q serial', '#PBS -P ERTH0834',
      '#PBS -l select=1:ncpus=1', '#PBS -l walltime=' + (files ? '24' : '12') + ':00:00', '#PBS -j oe',
      'exec > ~/lengau_snapshot.log 2>&1',
      'D=$(date +%F)',
      'OUT=~/lengau_snapshot_${D}_' + (files ? 'files' : 'folders') + '.tsv.gz',
      'echo "started $(date)"'
    ];
    if (files) {
      lines.push(
        'for root in ' + roots + '; do',
        "  find $root -xdev -type f -printf '%s\\t%TY-%Tm-%Td\\t%AY-%Am-%Ad\\t%u\\t%p\\n' 2>/dev/null",
        'done | gzip > $OUT');
    } else {
      lines.push(
        '{',
        '  echo "# lengau-snapshot folders $D"',
        '  for root in ' + roots + '; do',
        "    find $root -xdev -type f -printf '%s\\t%TY-%Tm-%Td\\t%AY-%Am-%Ad\\t%h\\n' 2>/dev/null |",
        "      awk -F'\\t' '{ b[$4] += $1; n[$4]++; if ($2 > m[$4]) m[$4] = $2; if ($3 > a[$4]) a[$4] = $3 }",
        "        END { for (d in b) printf \"%.0f\\t%d\\t%s\\t%s\\t%s\\n\", b[d], n[d], m[d], a[d], d }'",
        '  done',
        '} | gzip > $OUT');
    }
    lines.push('echo "done: $OUT"', 'EOF', 'qsub ~/lengau_snapshot.pbs');
    return lines.join('\n');
  }

  // one job packs every tarball on the list, and checks each one
  function tarJob() {
    var lines = [
      'mkdir -p /mnt/lustre/users/$USER/lengau_tars',
      'cat > ~/make_tars.pbs <<"EOF"',
      '#!/bin/bash', '#PBS -N make_tars', '#PBS -q serial', '#PBS -P ERTH0834',
      '#PBS -l select=1:ncpus=1', '#PBS -l walltime=24:00:00', '#PBS -j oe',
      'exec > ~/make_tars.log 2>&1',
      'T=/mnt/lustre/users/$USER/lengau_tars',
      '# pack FILE FROM [z]: tar exactly what find listed in FILE.list, then check the tarball has all of it',
      'pack() { tar c${3}f $T/$1 -C $2 --no-recursion -T $T/$1.list && [ "$(tar t${3}f $T/$1 | wc -l)" -eq "$(wc -l < $T/$1.list)" ] && echo "OK $1" || echo "FAILED $1"; }'
    ];
    for (var i = 0; i < state.folders.length; i++) {
      var f = state.folders[i];
      if (!isTar(f)) continue;
      var from = isHome(f) ? '$HOME' : isGroup(f) ? GROUP : '/mnt/lustre/users/$USER';
      lines.push('(cd ' + from + ' && find ' + rel(f) + findSkip(f) + ') > $T/' + tarFile(f) + '.list && pack ' +
        tarFile(f) + ' ' + from + (f.method === 'targz' ? ' z' : ''));
    }
    lines.push('echo "all done"', 'EOF', 'qsub ~/make_tars.pbs');
    return lines.join('\n');
  }
  function tarCopy(f) {
    return 'mkdir -p "' + D() + '" && ' + awake() + 'rsync -tv --partial --progress ' +
      at() + ':' + scratch() + '/lengau_tars/' + tarFile(f) + ' "' + D() + '/"' + OK;
  }
  function tarCheck(f) { return 'tar tf "' + D() + '/' + tarFile(f) + '" > /dev/null && echo "' + tarFile(f) + ' is complete"'; }
  // a leave-out name matches files and folders at any depth; a leave-out path (with a /) only that one,
  // counted from inside the folder. find and rsync agree on both.
  function findSkip(f) {
    var s = skips(f), tests = [];
    if (!s.length) return '';
    for (var i = 0; i < s.length; i++) {
      tests.push(s[i].indexOf('/') < 0 ? "-name '" + s[i] + "'" : "-path '" + rel(f) + '/' + s[i] + "'");
    }
    return ' \\( ' + tests.join(' -o ') + ' \\) -prune -o -print';
  }
  function rsyncSkip(f) {
    var s = skips(f), out = '';
    // rsync anchors a leading / at the top of the copy: inside the folder for ~, else at the folder's own name
    var top = f.path === '~' ? '/' : '/' + rel(f).split('/').pop() + '/';
    for (var i = 0; i < s.length; i++) out += " --exclude='" + (s[i].indexOf('/') < 0 ? s[i] : top + s[i]) + "'";
    return out;
  }
  // the whole home folder copies into home/; anything else copies into its parent, keeping its name
  function rsyncSrc(f) { return at() + ':' + remoteDir(f) + (f.path === '~' ? '/' : '/' + rel(f)); }
  function rsyncDest(f) { return f.path === '~' ? D() + '/home/' : dest(f); }
  function rsyncCopy(f) {
    return 'mkdir -p "' + rsyncDest(f) + '" && ' + awake() + 'rsync -rtv --partial --stats' + rsyncSkip(f) + ' ' +
      rsyncSrc(f) + ' "' + rsyncDest(f) + '"';
  }
  function rsyncCheck(f) {
    return 'rsync -rtn --itemize-changes' + rsyncSkip(f) + ' ' + rsyncSrc(f) + ' "' + rsyncDest(f) + '"';
  }
  // stream: tar on Lengau writes to the connection and tar here unpacks it, so nothing is written on Lengau.
  // It lands where rsync would put it, with the files' times, so rsync can finish a stream that stopped.
  function streamSkip(f) {
    var s = skips(f), names = '', paths = '';
    var top = f.path === '~' ? '.' : rel(f).split('/').pop();
    for (var i = 0; i < s.length; i++) {
      if (s[i].indexOf('/') < 0) names += " --exclude='" + s[i] + "'";
      else paths += " --exclude='" + top + '/' + s[i] + "'";
    }
    return names + (paths ? ' --anchored' + paths : '');   // --anchored only applies to the excludes after it
  }
  function streamSend(f, ssh) {
    var up = f.path === '~' ? '' : parent(rel(f));
    var name = f.path === '~' ? '.' : rel(f).split('/').pop();
    return ssh + ' ' + at() + ' "cd ' + remoteDir(f) + (up ? '/' + up : '') +
      ' && tar cf -' + streamSkip(f) + ' ' + name + '" | tar xf - -C "' + rsyncDest(f) + '"';
  }
  function streamCopy(f) {
    return 'mkdir -p "' + rsyncDest(f) + '" && ' + awake() + streamSend(f, 'ssh') +
      ' && echo "COPIED OK" || echo "STOPPED: finish it with the next command"';
  }

  // ---------- one script that copies and checks the whole list (Transfer page shortcut) ----------

  // Runs on your computer. Logs in once and shares that connection, so the password is asked for once.
  // Each folder that copies and checks is written to download_progress.txt on the drive, so running it
  // again skips those and carries on. A lost connection stops it with a note to run it again.
  var DL_SCRIPT = '~/lengau_download.sh';
  function dlLog() { return D() + '/download_progress.txt'; }
  function dlScript() {
    var all = allFolders();
    if (!all.length) return '# Nothing on your download list yet: add folders to it first.';
    var q = function (s) { return "'" + s + "'"; };
    var lines = [
      'cat > ' + DL_SCRIPT + ' <<"EOF"',
      '#!/bin/bash',
      '# Copies and checks every folder on your Lengau download list. Run it again any time:',
      '# folders already checked are skipped.',
      'D="' + D() + '"',
      'LOG="' + dlLog() + '"',
      'L=' + at(),
      'SSH="ssh -o ControlMaster=auto -o ControlPath=$HOME/.ssh/cm-%C -o ControlPersist=30m"',
      'export RSYNC_RSH="$SSH"',
      'mkdir -p "$D" ~/.ssh && touch "$LOG" || { echo "Cannot write to $D: is the drive plugged in?"; exit 1; }',
      'echo "Logging in to Lengau once for the whole run..."',
      '$SSH $L true || { echo "Cannot reach Lengau: connect the VPN and run this again."; exit 1; }',
      'TOTAL=' + all.length + ' N=0 DONE=0 LEFT=""',
      '# folder NAME HOW: count it, and skip it if an earlier run checked it',
      'folder() {',
      '  N=$((N + 1)); NAME=$1; HOW=$2',
      '  if grep -qxF "OK $HOW $NAME" "$LOG"; then DONE=$((DONE + 1)); echo "[$N/$TOTAL] $NAME: done already"; return 1; fi',
      '  echo; echo "[$N/$TOTAL] $NAME: copying ($HOW)..."',
      '}',
      'ok() { DONE=$((DONE + 1)); echo "OK $HOW $NAME" >> "$LOG"; echo "[$N/$TOTAL] $NAME: copied and checked. $((TOTAL - DONE)) to go"; }',
      'notok() {',
      '  LEFT="$LEFT  $NAME\\n"; echo "[$N/$TOTAL] $NAME: NOT COMPLETE"',
      '  $SSH $L true 2>/dev/null || { echo; echo "Lost the connection to Lengau, with $DONE of $TOTAL done."',
      '    echo "Reconnect the VPN and run this again: it carries on where it stopped."; exit 1; }',
      '}',
      '# complete RSYNC-ARGS: true when rsync finds nothing missing apart from links, which it leaves out',
      'complete() {',
      '  local out; out=$(rsync -rtn --itemize-changes "$@" 2>&1) || return 1',
      "  ! printf '%s\\n' \"$out\" | grep -v '^skipping non-regular file' | grep -q .",
      '}'
    ];
    for (var i = 0; i < all.length; i++) {
      var f = all[i], how = PILLS[f.method] || '.tar';
      var args = rsyncSkip(f) + ' ' + rsyncSrc(f) + ' "' + rsyncDest(f) + '"';
      lines.push('', 'if folder ' + q(f.path) + ' ' + how + '; then');
      if (isTar(f)) {
        lines.push(
          '  rsync -t --partial --progress ' + at() + ':' + scratch() + '/lengau_tars/' + tarFile(f) + ' "$D/" &&',
          '    tar tf "$D/' + tarFile(f) + '" > /dev/null && ok || notok');
      } else if (f.method === 'stream') {
        lines.push(
          '  mkdir -p "' + rsyncDest(f) + '"',
          '  ' + streamSend(f, '$SSH'),
          '  complete' + args + ' || { echo "  filling in what the stream missed..."; rsync -rt --partial' + args + '; }',
          '  complete' + args + ' && ok || notok');
      } else {
        lines.push(
          '  mkdir -p "' + rsyncDest(f) + '" && rsync -rt --partial --progress' + args,
          '  complete' + args + ' && ok || notok');
      }
      lines.push('fi');
    }
    lines.push(
      '',
      'echo; echo "== $DONE of $TOTAL folders copied and checked =="',
      'if [ -n "$LEFT" ]; then printf "Not complete:\\n$LEFT"; echo "Run this again to try those again."',
      'else echo "All done."; fi',
      'EOF',
      'echo "script written: ' + DL_SCRIPT + '"');
    return lines.join('\n');
  }

  // ---------- command boxes ----------

  // the icon in front says where to run it: laptop for your computer, server for Lengau
  function cmdBox(text, onLengau) {
    var row = document.createElement('div');
    row.className = 'lg-cmd' + (PLACEHOLDER.test(text) ? ' is-unfilled' : '');
    var icon = document.createElement('img');
    icon.className = 'lg-cmd-where';
    icon.src = onLengau ? 'data-server.svg' : 'laptop.svg';
    icon.alt = onLengau ? 'On Lengau:' : 'On your computer:';
    icon.title = onLengau ? 'Run this on Lengau' : 'Run this on your computer';
    icon.width = 32;
    icon.height = 32;
    var box = document.createElement('div');
    box.className = 'lg-cmd-box';
    var pre = document.createElement('pre');
    pre.textContent = text;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lg-copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy this command');
    box.appendChild(pre);
    box.appendChild(btn);
    row.appendChild(icon);
    row.appendChild(box);
    return row;
  }

  function copyText(btn, text) {
    function done() {
      btn.textContent = 'Copied';
      btn.classList.add('is-copied');
      setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('is-copied'); }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* leave it selectable */ }
      document.body.removeChild(ta);
    }
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('.lg-copy');
    if (!btn) return;
    copyText(btn, btn.parentNode.querySelector('pre').textContent);
    var slot = btn.closest('[data-cmd]');
    if (slot && slot.getAttribute('data-cmd') === 'settings') addSettings();
  });

  function renderCommands(selector) {
    var slots = document.querySelectorAll(selector || '[data-cmd]');
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var id = slot.getAttribute('data-cmd');
      var fresh = cmdBox(CMDS[id](), !!ON_LENGAU[id]);
      slot.className = fresh.className;
      slot.innerHTML = '';
      while (fresh.firstChild) slot.appendChild(fresh.firstChild);
    }
  }

  // commands written out in the page (TL;DR): the same box and Copy button, text as written but with
  // USERNAME and /path/to/drive filled in once they are known; data-static="lengau" or "here" for where it runs
  var statics = document.querySelectorAll('[data-static]');
  for (var si = 0; si < statics.length; si++) statics[si].lgText = statics[si].textContent.replace(/^\n+|\s+$/g, '');
  // a path typed on the TL;DR page wins; otherwise the drive set on the checklist, so nobody types it twice
  function hasDrive() { return !!(state.os === 'win' ? state.letter : state.drive); }
  function drivePath() { return state.drivePath || (hasDrive() ? D() : ''); }
  function renderStatics() {
    var path = drivePath();
    for (var i = 0; i < statics.length; i++) {
      var drive = path ? (/\s/.test(path) ? '"' + path + '"' : path) : '/path/to/drive';
      var fresh = cmdBox(statics[i].lgText.replace(/USERNAME/g, state.user || 'USERNAME').replace(/\/path\/to\/drive/g, drive),
        statics[i].getAttribute('data-static') === 'lengau');
      statics[i].className = fresh.className;
      statics[i].innerHTML = '';
      while (fresh.firstChild) statics[i].appendChild(fresh.firstChild);
    }
  }

  // ---------- OS-specific bits ----------

  function renderOS() {
    var bits = document.querySelectorAll('[data-os]');
    for (var i = 0; i < bits.length; i++) bits[i].hidden = bits[i].getAttribute('data-os') !== state.os;
  }

  // ---------- steps ----------

  function renderTicks() {
    var boxes = document.querySelectorAll('[data-tick]');
    for (var i = 0; i < boxes.length; i++) {
      var id = boxes[i].getAttribute('data-tick');
      boxes[i].checked = !!state.ticks[id];
      var step = document.querySelector('[data-step="' + id + '"]');
      if (step) step.classList.toggle('is-done', !!state.ticks[id]);
    }
    renderParts();
  }

  // ---------- checklist overview: each part is done when all its ticks are ----------

  var PARTS = {
    happening: ['happening'],
    need: ['before'],
    check: ['sizes', 'decide'],
    prepare: ['tars'],
    download: ['setup', 'copy', 'record']
  };

  function renderParts() {
    var parts = document.querySelectorAll('[data-part]');
    for (var i = 0; i < parts.length; i++) {
      var ids = PARTS[parts[i].getAttribute('data-part')];
      var n = 0;
      for (var j = 0; j < ids.length; j++) if (state.ticks[ids[j]]) n++;
      var st = parts[i].querySelector('.lg-part-state');
      st.textContent = n === ids.length ? 'done' : ids.length === 1 || n === 0 ? 'to do' : n + ' of ' + ids.length + ' done';
      parts[i].classList.toggle('is-done', n === ids.length);
    }
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.hasAttribute && t.hasAttribute('data-tick')) {
      state.ticks[t.getAttribute('data-tick')] = t.checked;
      save(); renderTicks();
    }
  });

  // ---------- the download list ----------

  var METHODS = {
    rsync: 'folder as it is (rsync)',
    stream: 'many small files (stream)',
    tar: 'tarball (.tar)',
    targz: 'compressed tarball (.tar.gz)'
  };
  var PILLS = { rsync: 'rsync', stream: 'stream', tar: '.tar', targz: '.tar.gz' };
  var SETTINGS = 'lengau_settings';   // written by the settings command on the Choose page

  function folderState(f) { return f.checked ? 'checked' : (f.copied ? 'copied' : 'to copy'); }
  function allFolders() { return state.folders; }
  function folderLabel(f) { return f.path === '~' ? '~ (your whole home folder)' : f.path; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // name, how it is copied, where it is up to, and remove (left off in the read-only window)
  function folderHead(f, index, readOnly) {
    var head = el('div', 'lg-folder-head');
    head.appendChild(el('span', 'lg-folder-name', folderLabel(f)));
    if (skips(f).length) head.appendChild(el('span', 'lg-folder-skip', 'without ' + skips(f).join(', ')));
    head.appendChild(el('span', 'lg-pill', PILLS[f.method] || '.tar'));
    var s = folderState(f);
    head.appendChild(el('span', 'lg-pill lg-pill--state' + (s === 'to copy' ? '' : ' is-' + s), s));
    if (readOnly) return head;
    var rm = el('button', 'lg-remove', 'remove');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove ' + f.path + ' from the list');
    rm.addEventListener('click', function () { state.folders.splice(index, 1); save(); renderList(); });
    head.appendChild(rm);
    return head;
  }

  function folderItem(f, index) {
    var li = el('li', 'lg-folder');
    li.appendChild(folderHead(f, index));

    var copyCmd, checkCmd, checkNote, copyNote;
    if (isTar(f)) {
      copyCmd = tarCopy(f); checkCmd = tarCheck(f);
      copyNote = 'Copy it, once Part 4 has packed it (run it again if the VPN drops):';
      checkNote = 'Check it: this should print "' + tarFile(f) + ' is complete".';
    } else if (f.method === 'stream') {
      copyCmd = streamCopy(f); checkCmd = rsyncCheck(f);
      copyNote = 'Copy it in one stream. If it stops, don\'t start again: the second command copies only what is missing:';
      checkNote = 'Check it: this should print nothing but "skipping non-regular file" for links, which the stream brought ' +
        'along. Anything else it lists, run the second copy command.';
    } else {
      copyCmd = rsyncCopy(f); checkCmd = rsyncCheck(f);
      copyNote = 'Copy it (run it again if the VPN drops):';
      checkNote = 'Check it: this should print nothing. Anything it lists is not on the drive yet, so run the copy again.';
    }
    var copyBoxes = [cmdBox(copyCmd)];
    if (f.method === 'stream') copyBoxes.push(cmdBox(rsyncCopy(f)));
    li.appendChild(folderStep(copyNote, copyBoxes, 'copied', f));
    li.appendChild(folderStep(checkNote, [cmdBox(checkCmd)], 'checked', f));
    return li;
  }

  function folderStep(text, boxes, field, f) {
    var wrap = el('div', 'lg-folder-step');
    wrap.appendChild(el('p', null, text));
    for (var i = 0; i < boxes.length; i++) wrap.appendChild(boxes[i]);
    var lab = el('label', 'lg-tick');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!f[field];
    cb.addEventListener('change', function () {
      f[field] = cb.checked;
      if (field === 'copied' && !cb.checked) f.checked = false;
      if (field === 'checked' && cb.checked) f.copied = true;
      save(); renderList();
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(field === 'copied' ? ' Copied' : ' Checked'));
    wrap.appendChild(lab);
    return wrap;
  }

  // the add form: on the list page and the Transfer page
  function addForm() {
    var form = el('form', 'panel panel--lavender lg-add');
    form.setAttribute('autocomplete', 'off');
    var options = '';
    for (var m in METHODS) options += '<option value="' + m + '">' + METHODS[m] + '</option>';
    form.innerHTML =
      '<label><span>Folder: a name in your scratch, as the <a href="check.html#sizes">size list</a> showed it, ' +
      '<code>~/</code> and a folder in your home, or a full path in the group folder</span>' +
      '<input name="path" placeholder="e.g. MYCONFIG/MYCONFIG-I or ~/models" spellcheck="false" required></label>' +
      '<label>Copy it<select name="method">' + options + '</select></label>' +
      '<label><span>Leave out <span class="lg-optional">(optional)</span></span>' +
      '<input name="skip" placeholder="e.g. TMPDIR_* *.o EXP01/old" spellcheck="false"></label>' +
      '<button class="btn blue" type="submit">Add to my list</button>' +
      '<p class="lg-add-error" role="alert" hidden></p>';
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = form.querySelector('.lg-add-error');
      var path = form.path.value.trim().replace(/^\.\//, '').replace(/^\/mnt\/lustre\/users\/[^\/]+\//, '')
        .replace(/^\/home\/[^\/]+(\/|$)/, '~$1').replace(/(.)\/+$/, '$1');
      var skip = form.skip.value.trim() ? form.skip.value.trim().split(/\s+/) : [];
      var msg = !path ? 'Type a folder name first.' : folderProblem(path, skip) || (hasFolder(path) ? path + ' is already on your list.' : '');
      err.textContent = msg;
      err.hidden = !msg;
      if (msg) return;
      var item = { path: path, method: form.method.value, copied: false, checked: false };
      if (skip.length) item.skip = skip;
      state.folders.push(item);
      form.path.value = '';
      form.skip.value = '';
      save(); renderList();
    });
    return form;
  }

  // what is wrong with a folder and its leave-outs, or '' when it can go in a command as it is
  function folderProblem(path, skip) {
    var name = path === '~' ? 'x' : path.replace(/^~\//, '').replace(GROUP + '/', '');
    if (path.charAt(0) === '/' && path.indexOf(GROUP + '/') !== 0) {
      return 'Only folders in your home, your scratch or the group folder (' + GROUP + '/…) can go on the list.';
    }
    if (/^~[^\/]/.test(path) || !SAFE.test(name) || /(^|\/)\.\.(\/|$)/.test(name)) {
      return 'Folder names with spaces, quotes or ".." would break the command. Rename the folder on Lengau, or ask the data manager.';
    }
    for (var i = 0; i < skip.length; i++) {
      if (!SKIP.test(skip[i]) || /(^|\/)\.\.(\/|$)/.test(skip[i])) {
        return 'Leave out takes names like TMPDIR_* or *.o, or paths inside the folder like EXP01/old, ' +
          'separated by spaces, without quotes or "..".';
      }
    }
    return '';
  }

  function hasFolder(path) {
    for (var i = 0; i < state.folders.length; i++) if (state.folders[i].path === path) return true;
    return false;
  }

  // copying the settings command puts its folder on the list
  function addSettings() {
    if (hasFolder(SETTINGS)) return;
    state.folders.push({ path: SETTINGS, method: 'rsync', copied: false, checked: false });
    save(); renderList();
  }

  // ---------- the list window: what is on the list, from the button on every other page ----------

  var LIST_PAGE = 'list.html';
  var LIST_TAB = 'lengau-list';   // links open the list page in one tab of its own, reused each time
  var listPage = document.getElementById('lg-list-items');

  var listBtn = el('button', 'lg-list-btn');
  listBtn.type = 'button';
  listBtn.setAttribute('aria-haspopup', 'dialog');
  listBtn.title = 'Download list';
  var cart = el('img', 'lg-list-cart');
  cart.src = 'cart.svg';
  cart.alt = '';
  listBtn.appendChild(cart);
  var listCount = el('span', 'lg-list-count');
  listBtn.appendChild(listCount);

  var dialog = el('dialog', 'lg-list-dialog');
  dialog.setAttribute('aria-labelledby', 'lg-list-title');
  var dHead = el('div', 'lg-list-head');
  var dTitle = el('h2', null, 'Your download list');
  dTitle.id = 'lg-list-title';
  var close = el('button', 'lg-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  dHead.appendChild(dTitle);
  dHead.appendChild(close);
  dialog.appendChild(dHead);
  dialog.appendChild(el('p', null, 'What is on your list so far. Add, remove and tick folders on the list page: ' +
    'keep it open in its own window next to the guide.'));
  var miniList = el('ul', 'lg-mini-list');
  dialog.appendChild(miniList);
  var openPage = el('a', 'lg-list-next', 'Open the download list →');
  openPage.href = LIST_PAGE;
  openPage.target = LIST_TAB;
  dialog.appendChild(openPage);

  if (!listPage) {
    document.body.appendChild(listBtn);
    document.body.appendChild(dialog);
  }

  function openList() {
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeList() {
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
  }
  listBtn.addEventListener('click', openList);
  close.addEventListener('click', closeList);
  openPage.addEventListener('click', closeList);
  dialog.addEventListener('click', function (ev) { if (ev.target === dialog) closeList(); });   // the backdrop

  // links to the list page in the text open it in its own tab too
  var listLinks = document.querySelectorAll('a[href^="' + LIST_PAGE + '"]');
  for (var lk = 0; lk < listLinks.length; lk++) listLinks[lk].target = LIST_TAB;

  // ---------- render the list wherever it shows ----------

  function renderList() {
    var all = allFolders();
    listCount.textContent = all.length;
    // the button is just the cart and the count, so its name says both
    listBtn.setAttribute('aria-label', 'Download list, ' + all.length + (all.length === 1 ? ' folder' : ' folders'));

    miniItems(miniList, true, 'Nothing on your list yet.');
    if (listPage) miniItems(listPage, false, 'Nothing on your list yet: add a folder or tick folders in a snapshot above.');
    var jump = document.querySelector('[data-list-count]');   // the note at the top of the list page
    if (jump) jump.textContent = all.length ? all.length + (all.length === 1 ? ' folder' : ' folders') : 'empty so far';

    // Transfer page: every item with its copy and check commands
    var list = document.getElementById('lg-folders');
    if (list) {
      list.innerHTML = '';
      var checked = 0;
      for (var j = 0; j < all.length; j++) {
        list.appendChild(folderItem(all[j], j));
        if (all[j].checked) checked++;
      }
      document.querySelector('.lg-progress').textContent = all.length ?
        checked + ' of ' + all.length + (all.length === 1 ? ' folder' : ' folders') + ' copied and checked' :
        'Nothing on your list yet: add folders above.';
    }

    // Prepare page: what the tarball job packs
    var pack = document.getElementById('lg-pack-list');
    if (pack) {
      pack.innerHTML = '';
      for (var k = 0; k < all.length; k++) {
        if (!isTar(all[k])) continue;
        var p = el('li');
        p.appendChild(el('code', null, all[k].path));
        p.appendChild(document.createTextNode(' → '));
        p.appendChild(el('code', null, tarFile(all[k])));
        if (skips(all[k]).length) p.appendChild(document.createTextNode(', without ' + skips(all[k]).join(', ')));
        pack.appendChild(p);
      }
      if (!pack.children.length) pack.appendChild(el('li', null, 'Nothing on your list is marked as a tarball yet.'));
    }

    var note = document.querySelector('[data-settings-note]');
    if (note && hasFolder(SETTINGS)) {
      note.innerHTML = '<code>' + SETTINGS + '</code> is on your download list.';
    }

    renderCommands('[data-cmd="tar-job"], [data-cmd="dl-script"]');   // built from the list; leave the other boxes (and their Copied) alone
    renderTree();
  }

  function miniItems(ul, readOnly, empty) {
    var all = allFolders();
    ul.innerHTML = '';
    for (var i = 0; i < all.length; i++) {
      var li = el('li', 'lg-mini');
      li.appendChild(folderHead(all[i], i, readOnly));
      ul.appendChild(li);
    }
    if (!all.length) ul.appendChild(el('li', 'lg-mini lg-mini--empty', empty));
  }

  // ---------- save the list to a file, and open it again (list page) ----------

  // the list lives in this browser only: a file lets people keep a copy, or carry on in another browser
  var saveBtn = document.getElementById('lg-save-list');
  var loadInput = document.getElementById('lg-load-list');
  var saveStatus = document.getElementById('lg-save-status');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var now = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());   // local, not UTC
      var data = { 'lengau-download-list': 1, saved: today, folders: state.folders };
      var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      var a = el('a');
      a.href = url;
      a.download = 'lengau_download_list_' + data.saved + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      saveStatus.textContent = 'Saved ' + state.folders.length + (state.folders.length === 1 ? ' folder' : ' folders') +
        ' to ' + a.download + ', in your Downloads folder.';
    });
  }
  if (loadInput) {
    loadInput.addEventListener('change', function () {
      var file = loadInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); } catch (e) { data = null; }
        if (!data || data['lengau-download-list'] !== 1 || !Array.isArray(data.folders)) {
          saveStatus.textContent = file.name + ' is not a saved download list.';
          return;
        }
        // folders already on the list stay as they are; anything that would break a command is left out
        var added = 0, had = 0, bad = [];
        for (var i = 0; i < data.folders.length; i++) {
          var f = data.folders[i] || {};
          var skip = Array.isArray(f.skip) ? f.skip.filter(function (x) { return typeof x === 'string'; }) : [];
          if (typeof f.path !== 'string' || !METHODS[f.method] || folderProblem(f.path, skip)) { bad.push(String(f.path)); continue; }
          if (hasFolder(f.path)) { had++; continue; }
          var item = { path: f.path, method: f.method, copied: f.copied === true, checked: f.checked === true };
          if (skip.length) item.skip = skip;
          state.folders.push(item);
          added++;
        }
        save(); renderList();
        saveStatus.textContent = 'Added ' + added + (added === 1 ? ' folder' : ' folders') + ' from ' + file.name +
          (had ? '; ' + had + ' already on your list' : '') + (bad.length ? '; left out ' + bad.join(', ') + ', which would break a command' : '') + '.';
        loadInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  var forms = document.querySelectorAll('[data-add-form]');
  for (var fi = 0; fi < forms.length; fi++) forms[fi].appendChild(addForm());

  // ---------- look inside a folder (Choose page) ----------

  var peek = document.querySelector('[data-peek]');
  if (peek) {
    peek.value = state.peek;
    peek.addEventListener('input', function () {
      var v = peek.value.trim().replace(/^\.\//, '').replace(/(.)\/+$/, '$1');
      state.peek = /^(~(\/[A-Za-z0-9._+\/ -]*)?|[A-Za-z0-9._+\/ -]+)$/.test(v) ? v : '';   // no quotes or $
      save(); renderCommands('[data-cmd="cd-dir"]');
    });
  }

  // ---------- snapshot tree (Choose page): open snapshots, tick folders onto the list ----------

  var ROOTS = [
    { key: 'home', label: 'Home folder (~)', re: /^\/home\/[^\/]+/ },
    { key: 'scratch', label: 'Scratch', re: /^\/mnt\/lustre\/users\/[^\/]+/ },
    { key: 'group', label: 'Group folder', re: /^\/mnt\/lustre\/groups\/erth0834/ }
  ];
  var tree = {};     // root key -> { node, source, date, kind }, from the latest snapshot that had that root
  var listed = {};   // list path -> item, rebuilt on every render
  var treeBox = document.getElementById('lg-tree');
  var viewOnly = !!treeBox && treeBox.hasAttribute('data-view-only');   // Tools page: sizes to read, nothing to tick
  var snapStatus = document.getElementById('lg-snap-status');
  var SHOW = 200;    // folders shown per level, largest first

  function bySize(x, y) { return y.bytes - x.bytes; }
  // per-file snapshots on the Tools page: only each folder's largest files stay in memory
  function keepFile(n, name, bytes, m) {
    var big = n.big || (n.big = []);
    big.push({ name: name, bytes: bytes, m: m });
    if (big.length >= 2 * SHOW) { big.sort(bySize); big.length = SHOW; }
  }

  function newNode(name, parent) { return { name: name, parent: parent, kids: null, bytes: 0, files: 0, m: '', a: '' }; }
  function child(node, name) {
    if (!node.kids) node.kids = {};
    return node.kids[name] || (node.kids[name] = newNode(name, node));
  }
  function rootOf(path) {
    for (var i = 0; i < ROOTS.length; i++) {
      var m = path.match(ROOTS[i].re);
      if (m && (path.length === m[0].length || path.charAt(m[0].length) === '/')) {
        return { root: ROOTS[i], rest: path.slice(m[0].length + 1) };
      }
    }
    return null;
  }

  // reads a snapshot (.tsv.gz or .tsv) line by line, so even millions of files never sit in memory at once.
  // per folder: bytes, files, newest modified, newest accessed, folder (after a "# lengau-snapshot" line)
  // per file:   bytes, modified, accessed, owner, path (the data manager's inventory format)
  function readSnapshot(blob, name, knownDate) {
    return blob.slice(0, 2).arrayBuffer().then(function (head) {
      var b = new Uint8Array(head), stream = blob.stream();
      if (b[0] === 0x1f && b[1] === 0x8b) {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('this browser cannot unpack .gz files. Unpack it first (gunzip ' + name + ') and open the .tsv');
        }
        stream = stream.pipeThrough(new DecompressionStream('gzip'));
      }
      var reader = stream.pipeThrough(new TextDecoderStream()).getReader();
      var roots = {}, kind = 'files', rest = '', lines = 0;
      var date = knownDate || (name.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
      function line(l) {
        if (!l) return;
        if (l.charAt(0) === '#') {
          var h = l.split(/\s+/);
          if (h[1] === 'lengau-snapshot') { kind = h[2]; date = h[3] || date; }
          return;
        }
        var c = l.split('\t');
        if (c.length < 5) return;
        var path = c.slice(4).join('\t');
        var dir = kind === 'folders' ? path : path.slice(0, path.lastIndexOf('/'));
        var r = rootOf(dir);
        if (!r) return;
        var top = roots[r.root.key] || (roots[r.root.key] = newNode(r.root.label, null));
        top.key = r.root.key;
        var n = top, parts = r.rest ? r.rest.split('/') : [];
        for (var i = 0; i < parts.length; i++) if (parts[i]) n = child(n, parts[i]);
        var folders = kind === 'folders';
        n.bytes += +c[0];
        n.files += folders ? +c[1] : 1;
        var m = folders ? c[2] : c[1], a = folders ? c[3] : c[2];
        if (m > n.m) n.m = m;
        if (a > n.a) n.a = a;
        if (viewOnly && !folders) keepFile(n, path.slice(path.lastIndexOf('/') + 1), +c[0], m);
        lines++;
      }
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) { line(rest); return; }
          var parts = (rest + res.value).split('\n');
          rest = parts.pop();
          for (var i = 0; i < parts.length; i++) line(parts[i]);
          return pump();
        });
      }
      return pump().then(function () { return { roots: roots, kind: kind, date: date, name: name, lines: lines }; });
    });
  }

  // totals for each folder and everything under it, and children sorted largest first
  function rollUp(n) {
    n.tb = n.bytes; n.tf = n.files; n.tm = n.m; n.ta = n.a;
    var kids = [];
    for (var k in n.kids) {
      var c = n.kids[k];
      rollUp(c);
      n.tb += c.tb; n.tf += c.tf;
      if (c.tm > n.tm) n.tm = c.tm;
      if (c.ta > n.ta) n.ta = c.ta;
      kids.push(c);
    }
    n.sorted = kids.sort(function (x, y) { return y.tb - x.tb; });
    if (n.big) { n.big.sort(bySize); if (n.big.length > SHOW) n.big.length = SHOW; }
  }

  function useSnapshot(snap) {
    var got = [];
    for (var key in snap.roots) {
      rollUp(snap.roots[key]);
      snap.roots[key].open = true;
      tree[key] = { node: snap.roots[key], source: snap.name, date: snap.date, kind: snap.kind };
      got.push(snap.roots[key].name);
    }
    snapStatus.textContent = got.length ?
      'Opened ' + snap.name + ': ' + got.join(', ') + '.' :
      snap.name + ' has no folders from your home, your scratch or the group folder in it.';
    renderTree();
  }
  function snapFailed(name, e) { snapStatus.textContent = 'Could not open ' + name + ': ' + (e && e.message || e); }

  var snapFile = document.getElementById('lg-snap-file');
  if (snapFile) snapFile.addEventListener('change', function () {
    var files = Array.prototype.slice.call(snapFile.files);
    files.reduce(function (p, f) {
      return p.then(function () {
        snapStatus.textContent = 'Reading ' + f.name + '…';
        return readSnapshot(f, f.name).then(useSnapshot, function (e) { snapFailed(f.name, e); });
      });
    }, Promise.resolve());
  });

  // ---- what a folder in the tree means for the list ----

  function itemKey(f) { return isHome(f) ? 'home' : isGroup(f) ? 'group' : 'scratch'; }
  function nodeRel(node) {
    var p = [];
    while (node.parent) { p.unshift(node.name); node = node.parent; }
    return p.join('/');
  }
  function toList(key, r) { return key === 'home' ? (r ? '~/' + r : '~') : key === 'group' ? (r ? GROUP + '/' + r : '') : r; }
  // the list item a folder falls under, and its path inside that item
  function coverOf(key, r) {
    var parts = r ? r.split('/') : [];
    for (var i = parts.length; i >= 0; i--) {
      var p = toList(key, parts.slice(0, i).join('/'));
      if (p && listed[p]) return { item: listed[p], sub: parts.slice(i).join('/') };
    }
    return null;
  }
  function globRe(g) {
    return new RegExp('^' + g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  }
  // the leave-out that drops a path inside an item, if any
  function leftOut(item, sub) {
    if (!sub) return null;
    var parts = sub.split('/'), s = skips(item);
    for (var i = 0; i < s.length; i++) {
      if (s[i].indexOf('/') >= 0) {
        if (sub === s[i] || sub.indexOf(s[i] + '/') === 0) return s[i];
      } else {
        for (var j = 0; j < parts.length; j++) if (globRe(s[i]).test(parts[j])) return s[i];
      }
    }
    return null;
  }
  function tickState(key, node) {
    var r = nodeRel(node), st = { r: r, lp: toList(key, r), cov: coverOf(key, r) };
    if (st.cov) {
      st.out = leftOut(st.cov.item, st.cov.sub);
      st.on = !st.out;
      var pre = st.cov.sub ? st.cov.sub + '/' : '';
      st.mixed = st.on && skips(st.cov.item).some(function (x) { return x.indexOf('/') >= 0 && x.indexOf(pre) === 0; });
    } else {
      var below = st.lp === '~' ? '~/' : st.lp + '/';
      st.mixed = state.folders.some(function (f) { return itemKey(f) === key && (!st.lp || f.path.indexOf(below) === 0); });
    }
    return st;
  }

  function dropSkips(item, sub) {   // sub and everything left out below it
    item.skip = skips(item).filter(function (x) { return x !== sub && x.indexOf(sub + '/') !== 0; });
    if (!item.skip.length) delete item.skip;
  }
  function toggleNode(key, node) {
    var st = tickState(key, node);
    if (st.on) {
      if (!st.cov.sub) state.folders.splice(state.folders.indexOf(st.cov.item), 1);   // it is a list item itself
      else { dropSkips(st.cov.item, st.cov.sub); st.cov.item.skip = skips(st.cov.item).concat([st.cov.sub]); }
    } else if (st.cov) {
      dropSkips(st.cov.item, st.out);   // put back what this exact path left out
    } else {
      var below = st.lp === '~' ? '~/' : st.lp + '/';   // one item for this folder replaces any below it
      state.folders = state.folders.filter(function (f) { return f.path.indexOf(below) !== 0; });
      state.folders.push({ path: st.lp, method: state.treeMethod, copied: false, checked: false });
    }
    save(); renderList();
  }

  // ---- drawing ----

  function fmtSize(b) {
    var u = ['B', 'K', 'M', 'G', 'T', 'P'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i && b < 10 ? b.toFixed(1) : Math.round(b)) + u[i];
  }
  function daysAgo(d) {
    var t = Date.parse(d + 'T00:00:00');
    return isNaN(t) ? null : Math.floor((Date.now() - t) / 864e5);
  }
  function longDate(d) {
    var t = Date.parse(d + 'T00:00:00');
    return isNaN(t) ? 'an unknown date' :
      new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function treeToggle(node, openable, focusNode) {
    var tg = el('button', 'lg-tree-toggle', openable ? (node.open ? '▾' : '▸') : '');
    tg.type = 'button';
    if (openable) {
      tg.setAttribute('aria-expanded', node.open ? 'true' : 'false');
      tg.setAttribute('aria-label', (node.open ? 'Close ' : 'Open ') + node.name);
      tg.addEventListener('click', function () { node.open = !node.open; renderTree(node); });
      if (node === focusNode) setTimeout(function () { tg.focus(); }, 0);
    } else {
      tg.disabled = true;
      tg.setAttribute('aria-hidden', 'true');
    }
    return tg;
  }

  // Tools page: what is inside a folder, folders and files together, largest first.
  // A snapshot of every folder only has a count for the files directly in a folder, so they share one row.
  function viewItems(node) {
    var items = (node.sorted || []).map(function (c) { return { node: c, bytes: c.tb }; });
    (node.big || []).forEach(function (f) { items.push({ file: f, bytes: f.bytes }); });
    if (!node.big && node.files && items.length) items.push({ here: node.files, bytes: node.bytes, m: node.m });
    return items.sort(bySize);
  }
  function viewCells(row, bytes, files, m) {
    row.appendChild(el('span', 'lg-tree-size', fmtSize(bytes)));
    row.appendChild(el('span', 'lg-tree-files', files ? files.toLocaleString('en-GB') + (files === 1 ? ' file' : ' files') : ''));
    row.appendChild(el('span', 'lg-tree-date', m ? 'changed ' + m : ''));
  }
  function viewLeaf(text, cls, bytes, m) {   // a file, or the files directly in a folder
    var li = el('li'), row = el('div', 'lg-tree-row');
    row.appendChild(el('span'));
    var name = el('span', 'lg-tree-name lg-tree-name--plain');
    name.appendChild(el('span', cls, text));
    row.appendChild(name);
    viewCells(row, bytes, 0, m);
    li.appendChild(row);
    return li;
  }
  function viewRow(node, focusNode) {
    var li = el('li'), row = el('div', 'lg-tree-row');
    var items = viewItems(node);
    var tg = treeToggle(node, items.length > 0, focusNode);
    row.appendChild(tg);
    var name = el('span', 'lg-tree-name' + (items.length ? '' : ' lg-tree-name--plain'));
    name.appendChild(el('span', 'lg-tree-label', node.parent ? node.name + '/' : node.name));
    if (items.length) name.addEventListener('click', function () { tg.click(); });   // the toggle is the keyboard route
    row.appendChild(name);
    viewCells(row, node.tb, node.tf, node.tm);
    li.appendChild(row);

    if (node.open && items.length) {
      var ul = el('ul');
      items.slice(0, SHOW).forEach(function (it) {
        if (it.node) ul.appendChild(viewRow(it.node, focusNode));
        else if (it.file) ul.appendChild(viewLeaf(it.file.name, 'lg-tree-label', it.bytes, it.file.m));
        else ul.appendChild(viewLeaf(it.here.toLocaleString('en-GB') + (it.here === 1 ? ' file' : ' files') + ' directly in this folder',
          'lg-tree-here', it.bytes, it.m));
      });
      var more = Math.max(items.length - SHOW, 0) + (node.big ? node.files - node.big.length : 0);
      if (more > 0) ul.appendChild(el('li', 'lg-tree-more', '… and ' + more.toLocaleString('en-GB') + ' smaller files and folders'));
      li.appendChild(ul);
    }
    return li;
  }

  function treeRow(key, node, focusNode) {
    var li = el('li');
    var row = el('div', 'lg-tree-row');
    var kids = node.sorted || [];
    row.appendChild(treeToggle(node, kids.length > 0, focusNode));

    var st = tickState(key, node);
    var label = el('label', 'lg-tree-name');
    if (st.lp) {
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!st.on;
      cb.indeterminate = !!st.mixed;
      var name = st.lp === '~' ? 'x' : st.lp.replace(/^~\//, '').replace(GROUP + '/', '');
      if (!SAFE.test(name)) {
        cb.disabled = true;
        label.title = 'This name has spaces or quotes, which would break the commands. Rename it on Lengau first.';
      } else if (st.out && st.out !== st.cov.sub) {
        cb.disabled = true;
        label.title = 'Left out by "' + st.out + '" on ' + st.cov.item.path + '. Change that on your download list.';
      } else {
        cb.addEventListener('change', function () { toggleNode(key, node); });
      }
      label.appendChild(cb);
    }
    label.appendChild(el('span', 'lg-tree-label', node.name));
    row.appendChild(label);
    row.appendChild(el('span', 'lg-tree-size', fmtSize(node.tb)));
    row.appendChild(el('span', 'lg-tree-files', node.tf.toLocaleString('en-GB') + (node.tf === 1 ? ' file' : ' files')));
    row.appendChild(el('span', 'lg-tree-date', node.tm ? 'changed ' + node.tm : ''));
    li.appendChild(row);

    if (node.open && kids.length) {
      var ul = el('ul');
      for (var i = 0; i < kids.length && i < SHOW; i++) ul.appendChild(treeRow(key, kids[i], focusNode));
      if (kids.length > SHOW) ul.appendChild(el('li', 'lg-tree-more', '… and ' + (kids.length - SHOW) + ' smaller folders'));
      li.appendChild(ul);
    }
    return li;
  }

  function findNode(key, r) {
    var n = tree[key].node, parts = r ? r.split('/') : [];
    for (var i = 0; i < parts.length; i++) { n = n.kids && n.kids[parts[i]]; if (!n) return null; }
    return n;
  }
  function itemBytes(f) {   // the folder minus what it leaves out, from the snapshot
    var key = itemKey(f), n = tree[key] && findNode(key, f.path === '~' ? '' : rel(f));
    if (!n) return null;
    var out = 0;
    (function walk(node, sub) {
      for (var i = 0; i < (node.sorted || []).length; i++) {
        var c = node.sorted[i], s = sub ? sub + '/' + c.name : c.name;
        if (leftOut(f, s)) out += c.tb; else walk(c, s);
      }
    })(n, '');
    return n.tb - out;
  }

  function renderTree(focusNode) {
    if (!treeBox) return;
    listed = {};
    for (var i = 0; i < state.folders.length; i++) listed[state.folders[i].path] = state.folders[i];
    treeBox.innerHTML = '';
    var keys = ROOTS.filter(function (r) { return tree[r.key]; });
    if (!keys.length) return;

    var info = el('ul', 'lg-snap-info');
    keys.forEach(function (r) {
      var t = tree[r.key], age = daysAgo(t.date);
      var li = el('li', null, r.label + ': ' + t.source + ', taken ' + longDate(t.date) +
        (t.kind === 'folders' ? ', per folder' : ', per file') + '.');
      if (age != null && age > 2) {
        li.appendChild(el('strong', 'lg-snap-old', ' ' + age + ' days old: if you are still running jobs, run it again.'));
      }
      info.appendChild(li);
    });
    treeBox.appendChild(info);

    if (viewOnly) {
      var mine = keys.filter(function (r) { return r.key !== 'group'; });
      if (mine.length) {
        var size = 0, count = 0;
        mine.forEach(function (r) { size += tree[r.key].node.tb; count += tree[r.key].node.tf; });
        treeBox.appendChild(el('p', 'lg-tree-total', mine.map(function (r) { return r.label; }).join(' + ') + ': ' +
          fmtSize(size) + ' in ' + count.toLocaleString('en-GB') + (count === 1 ? ' file.' : ' files.')));
      }
      var view = el('ul', 'lg-tree');
      keys.forEach(function (r) { view.appendChild(viewRow(tree[r.key].node, focusNode)); });
      treeBox.appendChild(view);
      return;
    }

    var how = el('label', 'lg-tree-method');
    how.appendChild(document.createTextNode('Ticked folders go on your list as '));
    var sel = el('select');
    for (var m in METHODS) {
      var o = el('option', null, METHODS[m]);
      o.value = m;
      o.selected = m === state.treeMethod;
      sel.appendChild(o);
    }
    sel.addEventListener('change', function () { state.treeMethod = sel.value; save(); });
    how.appendChild(sel);
    treeBox.appendChild(how);

    var bytes = 0, missing = 0;
    state.folders.forEach(function (f) { var b = itemBytes(f); if (b == null) missing++; else bytes += b; });
    var hours = bytes / (30 * Math.pow(1024, 3));
    treeBox.appendChild(el('p', 'lg-tree-total', 'On your list: ' + fmtSize(bytes) +
      (bytes ? ', about ' + (hours < 1 ? 'under an hour' : Math.ceil(hours) + ' hours') + ' over the VPN' : '') +
      (missing ? ' (plus ' + missing + (missing === 1 ? ' folder' : ' folders') + ' not in these snapshots)' : '') + '.'));

    var ul = el('ul', 'lg-tree');
    keys.forEach(function (r) { ul.appendChild(treeRow(r.key, tree[r.key].node, focusNode)); });
    treeBox.appendChild(ul);
  }

  // ---- the snapshot options ----

  var kindInputs = document.querySelectorAll('[name="snap-kind"]');
  function renderSnapOptions() {
    for (var i = 0; i < kindInputs.length; i++) kindInputs[i].checked = kindInputs[i].value === state.snap.kind;
    var warn = document.querySelector('[data-snap-files-warn]');
    if (warn) warn.hidden = state.snap.kind !== 'files';
  }
  document.addEventListener('change', function (ev) {
    if (ev.target.name !== 'snap-kind') return;
    state.snap.kind = ev.target.value;
    save(); renderSnapOptions(); renderCommands('[data-cmd="snap-job"]');
  });
  renderSnapOptions();

  // ---------- details ----------

  // the form is on the checklist page; the other pages read what it saved
  var form = document.getElementById('lg-details');
  function fillDetails() {
    if (!form) return;
    form.user.value = state.user;
    if (form.drivepath) form.drivepath.value = drivePath();
    if (!form.drive) return;   // the TL;DR page asks only for the username and the drive path
    form.drive.value = state.drive;
    form.letter.value = state.letter;
    for (var r = 0; r < form.os.length; r++) form.os[r].checked = form.os[r].value === state.os;
  }
  if (form) {
    fillDetails();
    form.addEventListener('input', function () {
      state.user = form.user.value.trim().replace(/[^A-Za-z0-9._-]/g, '');
      if (form.drivepath) {
        state.drivePath = form.drivepath.value.trim().replace(/["'\\$`]/g, '').replace(/(.)\/+$/, '$1');
        // the same as the checklist's drive: keep following the checklist rather than pinning a copy
        if (hasDrive() && state.drivePath === D()) state.drivePath = '';
      }
      if (form.drive) {
        state.drive = form.drive.value.replace(/["\\$`]/g, '');
        state.letter = form.letter.value.trim().replace(/[^A-Za-z]/g, '').slice(0, 1);
        for (var i = 0; i < form.os.length; i++) if (form.os[i].checked) state.os = form.os[i].value;
      }
      save(); renderAll();
    });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); });
  }

  function renderAll() { renderOS(); renderCommands(); renderStatics(); renderList(); }

  // a link to a folded-away section (check.html#snapshot) unfolds it
  var target = location.hash && document.getElementById(location.hash.slice(1));
  if (target && target.tagName === 'DETAILS') target.open = true;

  renderAll();
  renderTicks();

  // another tab (the list page, or a guide page next to it) saved: catch up
  window.addEventListener('storage', function (ev) {
    if (ev.key !== KEY) return;
    load();
    if (form && !form.contains(document.activeElement)) fillDetails();
    if (peek && document.activeElement !== peek) peek.value = state.peek;
    renderSnapOptions();
    renderAll();
    renderTicks();
  });
})();
