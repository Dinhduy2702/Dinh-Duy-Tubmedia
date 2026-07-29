Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

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
  StrCpy $0 ""

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

  ${If} $0 != ""
    StrCpy $INSTDIR "$0"
    StrCpy $IsUpgrade "1"
  ${EndIf}
FunctionEnd

Function SkipDirectoryPageForUpgrade
  ${If} $IsUpgrade == "1"
    Abort
  ${EndIf}
FunctionEnd

Section "Install" SEC_MAIN
  nsExec::ExecToLog 'taskkill.exe /F /T /IM "${APP_EXE}"'
  Sleep 1500
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File /r "${APP_SOURCE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"

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
  ${GetOptions} $0 "--force-run" $1
  ${IfNot} ${Silent}
    Exec '"$INSTDIR\${APP_EXE}"'
  ${ElseIf} $1 != ""
    Exec '"$INSTDIR\${APP_EXE}" --force-run'
  ${EndIf}
FunctionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill.exe /F /T /IM "${APP_EXE}"'
  Sleep 1500
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ; User database, settings, source media and output media are intentionally outside $INSTDIR.
  RMDir /r "$INSTDIR"
SectionEnd
