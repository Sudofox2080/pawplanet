@echo off
rem 爪爪星球 Android 壳工程的 Gradle 启动脚本（Windows）。
rem 仓库未提交 gradle-wrapper.jar，所以优先用 wrapper jar，其次退回系统 gradle。
setlocal

set "APP_HOME=%~dp0"
set "WRAPPER_JAR=%APP_HOME%gradle\wrapper\gradle-wrapper.jar"

if defined JAVA_HOME (
    set "JAVACMD=%JAVA_HOME%\bin\java.exe"
) else (
    set "JAVACMD=java"
)

if exist "%WRAPPER_JAR%" (
    "%JAVACMD%" -Dorg.gradle.appname=gradlew -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
    exit /b %ERRORLEVEL%
)

where gradle >nul 2>nul
if %ERRORLEVEL%==0 (
    gradle %*
    exit /b %ERRORLEVEL%
)

echo 找不到 gradle-wrapper.jar，也没有系统 gradle。
echo 请先安装 Gradle 8.7，然后在工程根目录执行: gradle wrapper --gradle-version 8.7
echo 生成 gradle\wrapper\gradle-wrapper.jar 之后，就可以用 gradlew.bat 构建了。
exit /b 1
