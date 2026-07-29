FIX10A corrects only the Windows PowerShell 5.1 verification script.
The original FIX10 source files are unchanged.
The old script compared a Vietnamese UTF-8 marker and could report a false negative under Windows PowerShell 5.1.
This script uses ASCII-only structural markers, then runs typecheck, ESLint, and the official build.
