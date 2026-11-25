Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
AllowSkipFiles off

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "generated-config.nsh"

Name "${PRODUCT_NAME}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${DEFAULT_INSTALL_DIRECTORY_NAME}"
InstallDirRegKey HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
VIProductVersion "${PRODUCT_FILE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "${COMPANY_NAME}"
VIAddVersionKey /LANG=1033 "FileDescription" "${PRODUCT_DESCRIPTION}"

Var IsUpgrade
Var IsAppUpdate

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE.txt"
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipDirectoryPageForUpgrade
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Vietnamese"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  StrCpy $IsUpgrade "0"
  StrCpy $IsAppUpdate "0"
  StrCpy $0 ""

  ; electron-updater always passes --updated. Force the update path to be
  ; silent even if a caller or a future updater version omits /S. A normal
  ; first-time installer still keeps the assisted wizard.
  ${GetParameters} $1
  ClearErrors
  ${GetOptions} $1 "--updated" $2
  ${IfNot} ${Errors}
    StrCpy $IsAppUpdate "1"
    SetSilent silent
  ${EndIf}

  ; Permanent Tubmedia registry key used by current installers.
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"

  ; Recover installations written only to the Windows uninstall registry.
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "InstallLocation"
  ${EndIf}

  ; Recover the pre-Tubmedia application identity without creating a duplicate app.
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_APP_ID}" "InstallLocation"
  ${EndIf}
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\${LEGACY_PRODUCT_NAME}" "InstallLocation"
  ${EndIf}

  ; Only reuse the previous install path when /D= was not explicitly passed
  ; and the old directory (or its root drive) still exists.
  ClearErrors
  ${GetOptions} $CMDLINE "/D=" $3
  ${If} ${Errors}
    ${If} $0 != ""
      StrCpy $4 $0 3
      ${If} ${FileExists} "$0\*.*"
        StrCpy $INSTDIR "$0"
        StrCpy $IsUpgrade "1"
      ${ElseIf} ${FileExists} "$4*.*"
        StrCpy $INSTDIR "$0"
        StrCpy $IsUpgrade "1"
      ${Else}
        StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${DEFAULT_INSTALL_DIRECTORY_NAME}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro CheckWriteLockTarget targetPath
  ${If} ${FileExists} "${targetPath}"
    ClearErrors
    FileOpen $R1 "${targetPath}" a
    ${If} ${Errors}
      StrCpy $R2 "1"
    ${Else}
      FileClose $R1
    ${EndIf}
  ${EndIf}
!macroend

!macro StopInstallDirProcessesAndWait
  ; Stop ONLY processes whose ExecutablePath is inside $INSTDIR\ (never kill broadly by name).
  System::Call 'Kernel32::SetEnvironmentVariable(t "TUBMEDIA_INSTDIR", t "$INSTDIR")'
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = [Environment]::GetEnvironmentVariable(\"TUBMEDIA_INSTDIR\"); if ($$dir) { $$prefix = ($$dir.TrimEnd(\"\\\") + \"\\\").ToLowerInvariant(); Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.ToLowerInvariant().StartsWith($$prefix) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"'
  StrCpy $R0 0
  ${DoWhile} $R0 < 10
    StrCpy $R2 "0"
    !insertmacro CheckWriteLockTarget "$INSTDIR\${APP_EXE}"
    !insertmacro CheckWriteLockTarget "$INSTDIR\resources\tool\ffmpeg.exe"
    !insertmacro CheckWriteLockTarget "$INSTDIR\resources\tool\yt-dlp.exe"
    !insertmacro CheckWriteLockTarget "$INSTDIR\resources\tool\aria2c.exe"
    !insertmacro CheckWriteLockTarget "$INSTDIR\resources\tool\deno.exe"
    ${If} $R2 == "0"
      ${ExitDo}
    ${EndIf}
    Sleep 1000
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = [Environment]::GetEnvironmentVariable(\"TUBMEDIA_INSTDIR\"); if ($$dir) { $$prefix = ($$dir.TrimEnd(\"\\\") + \"\\\").ToLowerInvariant(); Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.ToLowerInvariant().StartsWith($$prefix) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"'
    IntOp $R0 $R0 + 1
  ${Loop}
!macroend

Function SkipDirectoryPageForUpgrade
  ${If} $IsUpgrade == "1"
    Abort
  ${EndIf}
FunctionEnd

Section "Install" SEC_MAIN
  !insertmacro StopInstallDirProcessesAndWait
  SetOverwrite on
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "${APP_SOURCE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    Abort "Không thể ghi đè tệp ứng dụng vì tệp trong $INSTDIR đang bị khóa. Vui lòng đóng Tubmedia rồi thử lại."
  ${EndIf}

  ; Cache current installer for electron-updater differential (.blockmap) updates.
  ${If} "$EXEPATH" != "$LOCALAPPDATA\tubmedia-updater\installer.exe"
    CreateDirectory "$LOCALAPPDATA\tubmedia-updater"
    ClearErrors
    CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\tubmedia-updater\installer.exe"
    ClearErrors
  ${EndIf}

  ; Do not recreate shortcuts a user intentionally removed during an in-app
  ; update. A first install or a manually launched upgrade keeps normal setup behavior.
  ${If} $IsAppUpdate != "1"
    CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
    CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"
    CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}

  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "AppId" "${APP_ID}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "Publisher" "${COMPANY_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoRepair" 1
SectionEnd

Function .onInstSuccess
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--force-run" $1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${APP_EXE}" --force-run'
    Return
  ${EndIf}
  ${IfNot} ${Silent}
    Exec '"$INSTDIR\${APP_EXE}"'
  ${EndIf}
FunctionEnd

Section "Uninstall"
  !insertmacro StopInstallDirProcessesAndWait
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  Delete "$LOCALAPPDATA\tubmedia-updater\installer.exe"
  RMDir "$LOCALAPPDATA\tubmedia-updater"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ; User database, settings, source media and output media are intentionally outside $INSTDIR.
  RMDir /r "$INSTDIR"
SectionEnd
