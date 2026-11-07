Add-Type -AssemblyName System.Drawing
$root = (Get-Location).Path
$out = Join-Path $root 'data\demo'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-Avatar($path, $bg1, $bg2, $glyph, $fontName, $fontSize) {
  $W = 480; $H = 480
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAlias'
  $rect = [System.Drawing.RectangleF]::new([single]0, [single]0, [single]$W, [single]$H)
  $c1 = [System.Drawing.ColorTranslator]::FromHtml($bg1)
  $c2 = [System.Drawing.ColorTranslator]::FromHtml($bg2)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
  $g.FillRectangle($brush, $rect)
  # 柔和光斑
  $soft = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(46, 255, 255, 255))
  $g.FillEllipse($soft, 40, 40, 220, 220)
  $g.FillEllipse($soft, 250, 250, 200, 200)
  $font = New-Object System.Drawing.Font($fontName, $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
  $g.DrawString($glyph, $font, $ink, $rect, $fmt)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $path"
}

New-Avatar (Join-Path $out 'pet-dou.png') '#F6D9BE' '#EDB98F' '🐕' 'Segoe UI Emoji' 260
New-Avatar (Join-Path $out 'pet-nai.png') '#E4E9DC' '#C7D5BC' '🐈' 'Segoe UI Emoji' 260
