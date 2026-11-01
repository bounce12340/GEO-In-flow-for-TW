# 地域统计规则

GEOInflow TW 将台湾作为独立国家编码 `TW` 统计，县市使用 ISO 3166-2:TW 编码（例如 `TW-TPE`、`TW-KHH`、`TW-NWT`）。

- 国家编码：`TW`、`TWN`（任意大小写）归一化为 `TW`。旧记录中国家为 `CN` 或为空、省份为 `CN-71`、`CN-TW` 或 `CN-TPE`、`CN-KHH` 等台湾县市编码的记录，也计为 `TW`。国家为 `CN` 且省份为不带前缀的台湾县市编码（例如 `TPE`）的记录同样计为 `TW`。其他国家保持原值。
- 省份编码：能识别县市的台湾记录使用 `TW-<县市>`；`TWN-*` 与 `CN-<台湾县市>` 旧编码转换为对应的 `TW-*`。只说明台湾、没有县市信息的记录（仅有 `TW` / `TWN` 国家、`CN-71`、`CN-TW`）没有省份，与其他国家缺少省份时的处理相同，不推断县市。台湾县市目前没有中文显示名，显示原编码。
- 中国省份列表与省份覆盖率不再包含台湾；台湾访问不计入中国访问与中国省份覆盖率。
- 筛选：国家等值条件只比较归一化后的编码，`CN` 不匹配台湾记录，`TW` 匹配 `TW`、`TWN` 和旧的中国-台湾记录。省份条件 `CN-TPE`、`TWN-KHH` 等旧链接匹配对应的 `TW-*` 县市；`CN-71`、`CN-TW` 与“台湾”匹配全部台湾记录，包括没有县市信息的记录。
- 城市字段保留数据源提供的城市信息。没有国家或省份线索的记录保留缺失状态。
- 采集、PostgreSQL 与 ClickHouse 的分组查询、国家数量、地域筛选和显示复用 `src/lib/country.ts` 的规则。新采集的台湾访问写入 `TW` 与 `TW-*`。
- 历史数据在查询时归一化，原始记录和数据库结构保持不变，不新增迁移。
- 旧省份编码的包含、排除和正则条件，同时检查原始编码与归一化编码，保留已保存条件的匹配能力。地域规则版本为 `rules-6`，报告与统计缓存使用新版本命名空间，升级后重新生成。
- 世界地图恢复台湾图形的 `TWN` 编码。项目内没有台湾旗帜图片，台湾显示通用图标。

回归检查位于 `src/lib/country.test.ts`、`src/lib/detect.test.ts`、`src/lib/prisma.test.ts`、`src/lib/clickhouse.test.ts`、`src/lib/liekan/upstream/geography.test.ts`。`scripts/liekan-data-regression.mjs` 使用只读合成数据验证真实 PostgreSQL 的国家汇总、省份汇总和历史记录筛选。

## 简体中文地名与统计身份

猎看地域图表、城市明细、城市卡片、访客与访问轨迹和分享页面复用 `src/lib/liekan/contracts/geography.ts`。城市原始值保留在数据库与原有接口中；中文显示与查询归并使用独立规则。国内字母省份编码和数字编码归入同一省份，例如 `CN-SD` 与 `CN-37`、`CN-SN` 与 `CN-61`。山西与陕西保持独立。

城市以国家、实际观测到的省份和审核后的城市身份归并。省份缺失继续保留缺失，同名城市需要省份消歧；没有国家依据时保留原始城市名。常见同名拼音（包括 Suzhou、Taizhou、Yichun、Yulin、Fuzhou、Ji'an 与 Ji’an）缺省份时保留原名。只接受字典中明确登记的别名，保留区县、乡镇的自身名称，不根据距离或字符串相似性推断所属城市。海外未登记的城市保留数据源名称。

城市查找键在显示与数据库查询中统一处理 NFC、Unicode 首尾空白和大小写，国家与省份上下文也在城市查找边界去除首尾空白。包含与正则条件对名称及条件文本应用 NFC，正向与负向条件使用相同规则。数据库原值与未命中的查询输出保持兼容。

- 有城市、无中文译名：保留原名，参与已识别城市排名。
- 有省份、无城市：显示“山东 · 城市未知”等名称。
- 仅有国家：显示“中国 · 城市未知”等名称。
- 各级信息均缺失：显示“地域未知”。

别名先在完整事实中归并，再计算排名、搜索、排序与分页。会话、PV、跳出与转化的计数累加，平均时长使用时长总和与有效样本数。未知记录继续计入总体分母，城市缺失记录不参与城市 TOP1。并列值按地域身份稳定排序。

已保存的城市等值条件兼容原始名与中文名。包含、排除与正则条件分别检查每个明确别名和原始名称；负向条件排除所有匹配别名。条件值使用查询参数传递。ClickHouse 的固定地名目录也通过独立参数传入，组合筛选保持默认查询长度限制。原有接口返回城市原始值，中文自动补全只改变选项标签，其他语言沿用现有名称。

城市自动补全由服务器匹配别名，控件接收原值与中文标签并保留服务器结果。选项选择保存原值并回显中文，已有原值在选项加载后也显示对应标签。键入事件保留用户文字并更新搜索文本，组件内部填充标签的事件不覆盖原值。地域搜索、清除搜索与日期切换回到第一页；服务端把超出结果范围的地域页码调整到最后一个有效页，空结果采用第一页。

ClickHouse 城市表达式在每条查询的 `WITH` 中定义一次带明确入参的查找函数，城市、分群与分页子查询复用它。地域查询固定使用 `enable_global_with_statement=1` 以保持子查询可见性，原有 `WITH` 保留；无需修改数据库结构或提高全局查询长度上限。真实回归使用 ClickHouse 25.8 的默认分析器。

## 字典来源、许可与更新

字典版本 `2026-10-28.1` 包含 33 个省级名称和 408 个审核地名，覆盖截图中的城市、大陆地级市与已审核的自治州驻地，并保留部分已审核县市、香港、澳门和台湾地域名称。台湾地名归入国家 `TW`，与香港、澳门地名一样不设省份。目录位于 `src/lib/liekan/contracts/geography-catalog.json`，每项保留 GeoNames ID、国家、省份、简体中文名和明确别名。覆盖范围以目录为准，未命中原名不转为城市未知。

数据来源为 [GeoNames](https://www.geonames.org/)，下载日期为 2026-10-11，国别数据、语言别名数据和省级编码表的来源 URL 与 SHA-256 保存在目录中。数据采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可；猎看进行了地域筛选、中文名称审核与省份编码转换。署名及变更说明保存在 `public/liekan/licenses/geography.json`，关于页面与分享页保留署名。GeoNames 地名数据与 DB-IP/MaxMind IP 定位数据库分别署名。

GeoNames 的中国 `admin1` 编码采用 FIPS 编码，字典生成时通过审核过的对照转换为 ISO 编码。例如其山东代码 `25` 对应 `CN-37`，陕西代码 `26` 对应 `CN-61`。采集得到的 ISO 数字编码继续按 ISO 解释。

更新字典时审核稳定 ID、简体中文名和别名，明确处理同名与重复条目；不得批量导入将区县名称关联到另一城市的别名。更新目录版本、源文件校验值、`config/liekan/geography.json` 的文件校验值和许可说明。运行 `node scripts/liekan-geography-catalog.mjs` 检查目录完整性、293 个大陆地级市覆盖和省内别名冲突，再运行地域、报告、筛选和导出回归。应用运行与普通构建使用随版本固定的目录，不联网更新或翻译地名。

## 部分请求头补齐与历史数据

地域请求头齐全时直接使用。国家、省份或城市信息不完整时，尝试本地 City MMDB；国家必须一致，已有省份也必须一致。对仅缺省份但城市已经存在的情况，还需要城市信息一致。冲突、缺库或损坏时保留已有字段，事件采集正常继续。保留显式 IP、跳过请求头和 `SKIP_LOCATION_HEADERS` 的既有行为。

上游 PostgreSQL 会话的地域在创建时写入，既有会话再次访问保留原 session 地域。新增 Liekan 事件证据允许新访问使用当次识别结果，按下文的访问锚点规则查询。数据库没有保存可重新定位的访客原始 IP。已有英文城市可立即按目录显示中文，历史缺失城市继续保留缺失，升级不回填历史定位结果。

## 地域导出与缓存

地域页的导出按钮通过现有受权限保护的导出接口提交 `kind: geography`，在同一 PostgreSQL repeatable-read 快照内计算全量城市结果。日期、时区、搜索和排序与地域表相同，CSV 保留城市、会话、占比、平均时长、跳出率、转化率六列。原始地域组读取与最终文件分别限制在 100,000 组 / 行及 50 MiB；超过限制明确报错，支持取消、公式防护和敏感内容脱敏。ClickHouse 的完整地域导出沿用当前能力边界并返回明确的不支持状态。公共分享身份和未完成登录身份不获得私有导出权限。

页面报告、分享报告和受影响的统计缓存包含地名字典与规则版本；升级后重算。应用回滚恢复上一版本，自有增量迁移表保留，原始地域字段、账号和用户提供的地理数据库文件保持不变。

真实数据库补充回归：在名称以 `liekan_verify` 或 `liekan_regression` 开头的独立数据库中，运行 `pnpm exec tsx scripts/liekan-geography-regression.ts`；它只执行只读事务与合成地域数据，验证地域条件和候选查询。`scripts/liekan-data-regression.mjs` 同时验证原始地域组读取的行数与字节上限。

ClickHouse 补充回归运行 `pnpm exec tsx scripts/liekan-geography-clickhouse-regression.ts`，使用无网络的临时 ClickHouse 25.8 容器与合成数据，验证字符归一化、同名城市、负向条件、组合筛选、已有 `WITH`、分群与分页计数。它在结束时移除临时文件，容器自动退出删除。

## 实现参考

- [MaxMind City 数据字段](https://dev.maxmind.com/geoip/docs/databases/city-and-country/city-binary/) 将 GeoNames ID 与不同语言的名称分别提供；中文名称覆盖取决于定位库。猎看的审核目录使用稳定 ID，显示层独立选择中文名。
- [Plausible 定位采集](https://github.com/plausible/analytics/blob/master/lib/plausible/ingestion/geolocation.ex) 保存城市 GeoNames ID 与 ISO 地域编码，其 [Location 地名库](https://github.com/plausible/location) 独立提供地名数据。猎看现有记录仅有名称，因此查询时结合国家、省份与审核别名确定身份，保留缺失依据。
- [Matomo GeoIP2 地域处理](https://github.com/matomo-org/matomo/blob/5.x-dev/plugins/GeoIp2/LocationProvider/GeoIp2.php) 明确区分 FIPS 与 ISO 编码，并支持 DB-IP 与 MaxMind 数据库。猎看的目录更新也保留来源编码对照与定位库能力边界。
- [GeoNames 数据格式](https://download.geonames.org/export/dump/readme.txt) 提供语言、历史名称、地物类别与行政编码元数据；审核城市目录时保留对应地域身份与明确别名。

## Taiwan (English summary)

GEOInflow TW reports Taiwan as its own country code `TW`. `TWN` and legacy rows stored under China (country `CN` or empty with region `CN-71`, `CN-TW` or a `CN-<Taiwan county>` code) are normalized to `TW` at query time; stored values and the schema are unchanged. Counties use ISO 3166-2:TW codes (`TW-TPE`); records that name Taiwan without a county have no region. A `CN` country filter no longer matches Taiwan records. Old region links (`CN-TPE`, `TWN-KHH`) select the matching county, and `CN-71` selects every Taiwan record.

## Display language

Geographic labels accept an optional `zh-CN` or `en-US` display locale. Country and region codes and catalog city IDs determine the label. English city names use the catalog's existing English aliases. Unknown names retain the supplied text. Identity keys, aliases, merges, sorting, filters, counts and rates stay independent of display language. Optional report metadata carries the geographic identities for retained cards, charts and paginated rows. Geography CSV captures the requested locale; omitted locale retains the existing Chinese output.

## 城市榜单和覆盖率（city-known-1）

城市明细、分享 TOP12 和城市 CSV 仅包含城市字段非空的访问。库内没有中文翻译的真实城市继续显示原名称。先合并明确别名，再剔除城市缺失组，然后执行搜索、排序、分页和 TOP 限额。省份榜单剔除省份缺失组；已知省份、城市缺失的访问仍参与省份统计。

城市占比的分母是所选期间全部有效访问。PV、UV、访问总量、整体跳出和转化维持现有流量质量口径。`meta.geographyCoverage` 提供全量覆盖数据，搜索和分页保持覆盖率不变。城市覆盖率为已知城市访问数除以全部有效访问数；无访问时为 null，全部城市未识别时为 0。中国省份覆盖率使用已归类为 CN 的访问，包含既有项目地区归一化规则，国家级结果无法证明大陆城市。CSV 保留六列，在导出清单中提供覆盖率、显示规则版本和全量分母。

## IP 入口和排除规则

`CLIENT_IP_HEADER` 指定受信代理覆盖写入的单一入口；开启前核验代理清理客户端同名字段。`CLOUD_MODE` 的专用入口保留原兼容行为。有效受信入口优先于公开 payload IP。授权服务器采集器可使用验证后的 payload IP。未配置入口时，现有标准头和 payload 兼容路径继续工作，并记录未验证来源。公开 payload 不建立官方爬虫 IP 证明。

统一解析普通 IPv4、IPv6、带端口的括号 IPv6、Forwarded、X-Forwarded-For 的首个客户端地址。首项无效时不取后面的代理地址；继续寻找其他有效头。IPv4 映射 IPv6 转成 IPv4；原生 IPv6 和 NAT64 保留地址族。`IGNORE_IP` 支持归一化后的单地址和 CIDR，配置变化后重新编译。IPv4 映射 CIDR 仅在 /96 到 /128 内转换成对应 IPv4 前缀；更宽前缀按 IPv6 网络解释。运行中无效规则更新保留上一组有效规则，初次配置使用其中有效条目。该规则主动拒绝采集，地理信息缺失保持采集可用。

## 管理地理库和大陆补齐

镜像内默认 DB-IP City Lite 继续作为全局离线库。有效用户 `GEOLITE_DB_PATH` 文件优先，用户文件只读。Compose 为管理库增加独立持久卷：应用只读，现有日志 worker 写入，其他副本通过文件锁排队。每日检查供应商数据；所有下载先在新目录验证大小、SHA-256、City MMDB 类型、XDB 格式和地址族、来源字段及公开能力样本，再原子替换整个版本指针。读者固定一次查询的完整版本，装载成功后交换内存引用。损坏更新继续使用权限有效的上一版本；过期授权停止使用该版本。缺少库仍可采集。异常日志不输出 URL、密钥或地址。

`ip2region.js` 固定 3.1.8，使用官方 JavaScript IPv4/IPv6 缓冲查询，无在线逐 IP 请求。发行包只包括查询代码。XDB 数据需要独立许可清单，默认不会下载或分发。设置 `LIEKAN_GEO_XDB_MANIFEST` 指向容器内只读私有 JSON 清单，分别声明 ipv4 和 ipv6：`path`、`sha256`、`authorized:true`、`license`、`source`、`expiresAt` 和可选 `buildTime`。两个文件同时通过验证才发布。清单内不放访问者地址。

默认 `LIEKAN_GEO_CHINA_MODE=shadow`。国家和省份必须一致，市名上下文明确才补字段；完整原结果保持原值。提供方 `0`、unknown、空白等缺失标记在适配层转成缺失值。省全名和城市行政后缀只使用审核过的精确映射。国家或省份冲突保留原结果并记原因。大陆补齐只接收明确 CN 的大陆记录，全球其他结果继续使用 MMDB。

正式补齐要求 `active` 和清单 activation 审核共同满足：300 条独立标注真实样本，IPv4、IPv6 各 100 条，20 个省份，3 家运营商及移动和宽带，60 条新补城市，省份准确率 95%、城市 90%、缺失减少 30%、既有完整样本全部保留、7 天试运行、有效 evidenceId，并绑定此次 MMDB 和双栈 XDB 的 SHA-256。样本或数据权限未完成时保留影子模式。公开 DNS 地址仅用于查询能力测试。用户通过 GEOLITE_DB_PATH 指定的库保持优先；其大陆补齐保留影子模式。正式补齐使用审核清单所绑定的管理库版本，库变化后重新审核。

自定义自动下载源通过 `GEO_DATABASE_URL` 和 `LIEKAN_GEO_SOURCE_MANIFEST` 声明独立数据授权；MaxMind 自动下载需要有效账号和许可密钥。私有源清单和用户库需以只读挂载进入容器，示例见 `docs/local-deployment.md`。管理锁在异常终止后可能保留，先确认没有更新进程，再移除该锁目录；其余文件保持不动。保留的上一代数据供回退使用。

## 事件证据、历史和诊断

增量迁移 019 新增独立地域证据表，020 保留缺少历史 session 元数据的有效事件计数，上游 session 和 website_event 结构保持不变。事件、地域、流量质量、属性、收入和 UUID 回执在同一事务提交。证据保留国家、省份、城市的完整元组、来源、可信性、地址族、精度、缺失或冲突原因、库和规则版本、城市标识、实际库提供的精度半径、处理时间及影子汇总，禁止保存原始 IP 或完整 UA。

每次访问使用 `(website_id,session_id,visit_id)` 全历史中按事件时间、事件 ID 最早的当前质量策略内 PV 作地域锚点；锚点有证据时使用其完整元组，无证据时使用原 session 元组。日期窗口只决定候选访问和统计事件，锚点不随窗口移动。升级前开始的同一访问保留原锚点；同一旧匿名会话的新访问可以使用新地域。晚到的更早事件重新决定锚点并更新统计修订。回补事件的定位以接收时的库为依据，处理时间独立于事件时间。索引按网站、会话和访问限制锚点查找。

新日志在已验证原始地址仍在内存时查询地域，持久化任务仅带派生证据。原始导入摘要、事件指纹和批次标识先按原算法计算，后续数据库变化不会导致重复导入。输入声明地域与库查询分别记录。历史哈希和掩码无法定位，重放原始源文件需要独立授权。

`GET /api/liekan/websites/{websiteId}/geography/diagnostics` 要求完整账户和站点查看权限，拒绝分享身份和未完成双重验证。返回全量城市及省份覆盖、事件精度、缺失/冲突原因、来源和信任分布、影子结果、版本和有效配置状态，不返回原始 IP、UA、路径、密钥或源文件位置。入口拒绝和无效 IP 仅记录分钟计数，保存 90 天。ClickHouse 明确返回证据诊断未支持，原有地域查询维持兼容。

地域诊断复用统计查询的并发和排队保护，查询截止时间为 60 秒，地域事实最多 100,000 行、50 MiB。超量返回 413；队列已满、排队或查询超时返回 503，可缩小日期范围后重试。站点重置和删除同步清除入口诊断计数。原生地域指标、明细、收入地域和地域筛选选项使用事件所属访次的完整地域锚点；同一访客的新访次可拥有新的地域。

原生收入筛选保留访客群组语义：时间窗口内满足条件的访客，其有效收入都会计入。收入地域按每笔收入事件所属访次分组，同一访客的多次访问可分布在多个地区，地域分组金额之和等于该访客群组的总收入。
