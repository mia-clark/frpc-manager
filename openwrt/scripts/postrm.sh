#!/bin/sh
# =============================================================================
# nfpm postremove — 清理 frpcmgrd-fetch 装到 /usr/bin 的二进制（opkg 不追踪它，
#   因为是 postinst 联网下载的，不在包文件清单里，需手动删）。
#
#   升级判定：postrm 在包文件删除后执行；若升级，新包的 frpcmgrd-fetch 仍在，
#   则跳过删除二进制（交给新包 postinst 重新拉取）；仅真正卸载时清理。
#   镜像构建阶段 ($IPKG_INSTROOT 非空) 跳过。
# =============================================================================
[ -n "${IPKG_INSTROOT}" ] && exit 0

# 升级场景：新包 fetcher 仍在 -> 不删二进制
[ -x /usr/sbin/frpcmgrd-fetch ] && exit 0

rm -f  /usr/bin/frpcmgrd
rm -rf /usr/lib/frpcmgrd

exit 0
