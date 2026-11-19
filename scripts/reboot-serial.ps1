$port = New-Object System.IO.Ports.SerialPort "COM5", 115200, None, 8, One
$port.ReadTimeout = 1000
$port.DtrEnable = $false
$port.RtsEnable = $true
$port.Open()

# Pulse RTS to reset ESP32
$port.RtsEnable = $true
Start-Sleep -Milliseconds 100
$port.RtsEnable = $false
Start-Sleep -Milliseconds 200

Write-Host "Reset ESP32. Reading boot output for 5 seconds..."
$endTime = (Get-Date).AddSeconds(5)
while ((Get-Date) -lt $endTime) {
    try {
        $line = $port.ReadLine()
        Write-Host $line
    } catch [System.TimeoutException] {}
}

$port.Close()
Write-Host "Done."
