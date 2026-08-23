pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

BorderSurface {
  id: root
  required property var inputData
  required property string threadId
  required property var service
  property var answers: ({})

  function valueFor(questionId) { return answers[String(questionId)] }
  function isSelected(questionId, label) {
    var value = valueFor(questionId)
    return Array.isArray(value) ? value.indexOf(label) >= 0 : value === label
  }
  function setOption(question, label) {
    var next = {}
    for (var key in answers) next[key] = answers[key]
    var id = String(question.id)
    if (question.multiSelect) {
      var values = Array.isArray(next[id]) ? next[id].slice() : []
      var index = values.indexOf(label)
      if (index >= 0) values.splice(index, 1)
      else values.push(label)
      next[id] = values
    } else next[id] = label
    answers = next
  }
  function setCustom(questionId, value) {
    var trimmed = String(value).trim()
    if (!trimmed) return
    var next = {}
    for (var key in answers) next[key] = answers[key]
    next[String(questionId)] = trimmed
    answers = next
  }
  function complete() {
    var questions = inputData.questions || []
    for (var i = 0; i < questions.length; i++) {
      var value = valueFor(questions[i].id)
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || String(value).length === 0) return false
    }
    return questions.length > 0
  }

  width: parent ? parent.width : implicitWidth
  height: content.implicitHeight + Style.spacing.rowPaddingX * 2
  radius: Style.cornerRadius
  color: Util.alpha(Color.accent, 0.10)
  borderSpec: Border.controlSpec("selected", Color.foreground, Color.accent)

  Column {
    id: content
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    anchors.margins: Style.spacing.rowPaddingX
    spacing: Style.spacing.lg

    Text {
      text: "T3 needs your input"
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.subtitle
      font.bold: true
    }

    Repeater {
      model: root.inputData.questions || []
      Column {
        id: questionBlock
        required property var modelData
        width: content.width
        spacing: Style.spacing.md

        Text {
          width: parent.width
          text: String(parent.modelData.header || "Question") + "\n" + String(parent.modelData.question || "")
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
        }
        Flow {
          width: parent.width
          spacing: Style.spacing.sm
          Repeater {
            model: questionBlock.modelData.options || []
            Button {
              required property var modelData
              text: String(modelData.label)
              tooltipText: String(modelData.description || "")
              active: root.isSelected(questionBlock.modelData.id, String(modelData.label))
              onClicked: root.setOption(questionBlock.modelData, String(modelData.label))
            }
          }
        }
        TextField {
          width: parent.width
          placeholderText: "Or type another answer"
          onEditingFinished: root.setCustom(parent.modelData.id, text)
        }
      }
    }

    Button {
      anchors.right: parent.right
      text: "Submit answers"
      iconText: "󰒊"
      active: true
      enabled: root.complete()
      onClicked: root.service.respondInput(root.threadId, String(root.inputData.requestId), root.answers)
    }
  }
}
