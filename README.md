# 汽车改装合规交接

本项目保存“汽车改装合规交接”领域中跨机构交换记录的基础约定，并提供一套可运行的最小平台：围绕每个不可变里程节点重建车辆当前配置，把零部件身份与认证、安装技师、施工和标定、检测报告、登记与保险告知、事故维修、替换拆除、复原以及所有权变更汇入同一条演化链。

平台只依据已收录证据给出**待核验范围**，不冒充检测或登记机关下结论。

## 设计原则

- **证据优先**：所有评估输出均为“待核验范围”，逐项标注证据状态（已收录 / 待核验）并附中文说明；输出自带免责声明，不构成检测或登记结论。
- **不可变里程节点**：`ODOMETER_RECORDED` 的 `checkpoint_id` 一经记录不可变更（冲突的改写会被拒绝）；里程回退记为事实异常进入待核验，而不是静默接受。
- **撤销命中安装组合**：证书撤销（`CERTIFICATE_REVOKED`）命中的是“车辆 × 零部件 × 安装组合”，而非整车或零件抽象。
- **跨地区不改历史**：按使用地现行规则评估未来状态的待核验范围；评估是只读操作，历史事件与既有评估保持不变。
- **所有权即权限切换点**：`OWNERSHIP_TRANSFERRED` 被接受后，旧车主的远程访问随即失效，仅当前车主可取得新凭证与当前配置说明。
- **最小披露**：交接说明只收录与当前在装组合相关的事故维修；历史细节以摘要（事件计数、链头）呈现，便于核对完整性而不泄露无关内容。

## 多方乱序重报与去重

事件由 `event_id` 唯一标识，`aggregate_id` 指向业务对象，`version` 从 1 开始递增，`occurred_at` 保留真实发生时间。来源系统重试时必须沿用原事件标识。

- 同一 `event_id` 内容一致的重报被幂等去重；内容不同视为标识冲突，拒绝并保留原记录。
- 事件可按任意顺序到达，读取时按 `(version, occurred_at, event_id)` 重排。
- 同一聚合同一 `version` 出现不同事件时双方都保留，并记入冲突清单，由评估环节列为待核验。

## 事件类型与聚合归属

| 事件类型 | 含义 | 聚合 |
| --- | --- | --- |
| `PART_CERTIFIED` | 零部件身份与认证 | `certified_part`（零部件标识） |
| `CERTIFICATE_REVOKED` | 证书撤销 | `certified_part` |
| `PART_INSTALLED` | 安装（含技师与施工记录） | `vehicle_configuration`（车辆标识） |
| `INSTALLATION_CALIBRATED` | 施工后的标定 | `vehicle_configuration` |
| `ODOMETER_RECORDED` | 不可变里程节点 | `vehicle_configuration` |
| `CONFIGURATION_INSPECTED` | 检测报告 | `inspection_finding`（报告标识，车辆由 `payload.vehicle_id` 关联） |
| `REGISTRATION_UPDATED` | 登记告知 | `vehicle_configuration` |
| `INSURANCE_NOTIFIED` | 保险告知 | `vehicle_configuration` |
| `ACCIDENT_REPAIRED` | 事故维修 | `vehicle_configuration` |
| `PART_REPLACED` | 替换（旧组合退役 + 新组合上线） | `vehicle_configuration` |
| `PART_REMOVED` | 拆除 | `vehicle_configuration` |
| `CONFIGURATION_RESTORED` | 复原 | `vehicle_configuration` |
| `OWNERSHIP_TRANSFERRED` | 所有权变更（权限切换点） | `ownership_transfer`（车辆标识） |

各事件负载的必备字段见 `src/domain.js` 的 `PAYLOAD_REQUIRED`。

## 模块地图

- `contracts/domain.schema.json`：事件信封与本领域允许的聚合、事件类型。
- `src/domain.js`：事件类型、聚合类型与负载必备字段。
- `src/validator.js`：事件信封校验（中文错误）。
- `src/event-store.js`：事件存储——去重、乱序重排、版本冲突记录、里程节点不可变。
- `src/configuration.js`：配置投影——沿演化链重放，支持按里程节点重建当时在装配置。
- `src/compliance.js`：证据链评估——输出待核验范围；`findRevocationImpacts` / `revocationReport` 处理证书撤销命中。
- `src/regional.js`：跨地区评估——按当地现行规则裁剪证据环节，只读不改历史。
- `src/access.js`：访问权限——所有权转移即权限切换。
- `src/statement.js`：当前配置说明——每项结论可回到安装、复检和登记依据，最小披露。
- `data/sample.json`：单条信封样例；`data/sample-history.json`：二手房车（悬架、电气、外观套件来自三家工坊）的完整演化链样例。

## 本地检查

运行 `node --test`。
