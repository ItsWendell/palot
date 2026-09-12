import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "palot.tasks"
  property var snapshot: null
  property bool processAlive: false
  readonly property string appID: setting("channel", "nightly") === "stable" ? "dev.palot.desktop" : "dev.palot.desktop.nightly"
  readonly property string executable: setting("executable", "palot-nightly")
  readonly property bool connected: snapshot !== null && processAlive
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function parse(content) {
    try {
      var value = JSON.parse(content)
      snapshot = value.version === 1 && Number.isInteger(value.pid) && value.pid > 0 && Array.isArray(value.tasks) ? value : null
    } catch (error) { snapshot = null }
    processAlive = false
    checkProcess()
  }

  function checkProcess() {
    if (!snapshot || alive.running) return
    alive.command = ["test", "-d", "/proc/" + snapshot.pid]
    alive.running = true
  }

  FileView {
    path: Quickshell.env("XDG_RUNTIME_DIR") + "/palot/" + root.appID + ".json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.parse(text())
    onLoadFailed: { root.snapshot = null; root.processAlive = false }
  }
  Process {
    id: alive
    onExited: function(code) { root.processAlive = code === 0 }
  }
  Timer {
    interval: 30000
    running: root.snapshot !== null
    repeat: true
    onTriggered: root.checkProcess()
  }
  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.connected ? "P " + root.snapshot.running + (root.snapshot.attention ? " · !" + root.snapshot.attention : "") : "P"
    tooltipText: root.connected ? root.snapshot.running + " running · " + root.snapshot.attention + " need attention\nClick to open the next task. Right-click for a new task." : "Open Palot"
    onPressed: function(mouseButton) {
      var args = [root.executable, "--show"]
      if (mouseButton === Qt.RightButton) args = [root.executable, "--new-task"]
      else if (root.connected && root.snapshot.tasks.length > 0 && /^ses[_a-zA-Z0-9-]+$/.test(root.snapshot.tasks[0].sessionID)) args = [root.executable, "--task", root.snapshot.tasks[0].sessionID]
      Quickshell.execDetached(args)
    }
  }
}
