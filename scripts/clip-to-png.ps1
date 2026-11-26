param(
  [string]$Out = 'shot.png'
)

# 从剪贴板读取浏览器写出的 base64（dataURL 去掉前缀的部分），解码成 PNG 文件。
# 用法：
#   1) 在 evaluate_script 里 await navigator.clipboard.writeText(b64)
#   2) pwsh -File scripts\clip-to-png.ps1 -Out shot.png
#   3) 用 read_image 读 shot.png

$b64 = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($b64) -or $b64.Length -lt 100) {
  throw '剪贴板里没有足够的 base64 数据；先在浏览器里写剪贴板。'
}

$dest = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Out))
[System.IO.File]::WriteAllBytes($dest, [System.Convert]::FromBase64String($b64))

$bytes = [System.IO.File]::ReadAllBytes($dest)
$sig = [System.BitConverter]::ToString($bytes[0..7])
if ($sig -ne '89-50-4E-47-0D-0A-1A-0A') {
  throw "生成的文件不是合法 PNG（头=$sig）"
}

Write-Output "OK $dest ($($bytes.Length) bytes)"
