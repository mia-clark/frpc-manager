#!/bin/sh
# =============================================================================
# nfpm postinstall — 装包后：联网拉取本机架构的二进制 -> 启用并启动服务
#   opkg/apk 安装时执行 (镜像构建阶段 $IPKG_INSTROOT 非空，跳过)。
#   本包是 all 架构：不含二进制，由 frpcmgrd-fetch 按 CPU 自动下载对应版本。
# =============================================================================
[ -n "${IPKG_INSTROOT}" ] && exit 0

_fetched=0
if [ -x /usr/sbin/frpcmgrd-fetch ]; then
	if /usr/sbin/frpcmgrd-fetch; then
		_fetched=1
	fi
fi

# 启停细节由 init 脚本写入 logd；这里只判定结果，且不因失败 exit 非 0
# （避免把包标记为 config-failed 留下半安装状态）。
_started=0
if [ "$_fetched" = "1" ] && [ -x /etc/init.d/frpcmgrd ]; then
	/etc/init.d/frpcmgrd enable >/dev/null 2>&1
	/etc/init.d/frpcmgrd start  >/dev/null 2>&1 && _started=1
fi

_token="$(uci -q get frpcmgrd.main.token 2>/dev/null)"
_addr="$(uci -q get frpcmgrd.main.http_addr 2>/dev/null)"
[ -n "$_addr" ] || _addr=":8080"

echo ""
echo "==================================================================="
if [ "$_started" = "1" ]; then
	echo " frpcmgrd 已安装并启动 ✓"
elif [ "$_fetched" = "1" ]; then
	echo " frpcmgrd 二进制已下载，但服务未能启动 ✗"
	echo "   排查: logread -e frpcmgrd   修好后: /etc/init.d/frpcmgrd start"
else
	echo " frpcmgrd 壳子已安装，但二进制下载失败（可能无网络）✗"
	echo "   联网后执行: frpcmgrd-fetch   再: /etc/init.d/frpcmgrd start"
fi
echo "-------------------------------------------------------------------"
echo " 访问后台 : http://<路由器IP>${_addr}"
echo " API 令牌 : ${_token:-（启动后用 uci get frpcmgrd.main.token 查看）}"
echo ""
echo " 改端口/令牌:"
echo "   uci set frpcmgrd.main.http_addr=':9000'"
echo "   uci set frpcmgrd.main.token='你的强随机令牌'"
echo "   uci commit frpcmgrd && /etc/init.d/frpcmgrd restart"
echo ""
echo " 服务管理: /etc/init.d/frpcmgrd {start|stop|restart|enable|disable}"
echo " 实时日志: logread -e frpcmgrd -f"
echo " 升级    : 联网执行 frpcmgrd-fetch <新版本>，或重装新版 all ipk"
echo "==================================================================="
echo ""

exit 0
