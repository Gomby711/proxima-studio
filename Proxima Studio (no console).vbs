' Double-click to build the latest version and launch Proxima Studio
' with no visible console window.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = scriptDir
' 0 = hidden window, True = wait for build+launch chain
sh.Run "cmd /c npx vite build && npx electron .", 0, False
