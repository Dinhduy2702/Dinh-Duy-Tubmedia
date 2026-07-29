!include "LogicLib.nsh"

!macro customInit
  ReadRegStr $0 HKCU "Software\Tubmedia\DownloadVideo" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Tubmedia\DownloadVideo" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Tubmedia\DownloadVideo" "AppId" "com.tubmedia.download-video"
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Tubmedia\DownloadVideo" "InstallLocation"
  DeleteRegValue HKCU "Software\Tubmedia\DownloadVideo" "AppId"
  DeleteRegKey /ifempty HKCU "Software\Tubmedia\DownloadVideo"
!macroend
