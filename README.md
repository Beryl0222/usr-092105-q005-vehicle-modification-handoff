# 汽车改装合规交接

本项目保存“汽车改装合规交接”领域中跨机构交换记录的基础约定，并提供可运行的平台原型：围绕每个不可变里程节点重建车辆当前配置，把零部件身份与认证、安装技师、施工标定、检测报告、登记与保险告知、事故维修、替换拆除、复原、所有权变更纳入同一条演化链。

平台的立场：**只依据证据圈定待核验范围，不冒充检测或登记机关下结论**。

## 领域资料

- `contracts/domain.schema.json`：事件信封、九类事件与四类聚合的绑定关系、`fact_key`/`payload` 约定。
- `data/sample.json`：一条可用于本地联调的中文样例。
- `data/scenario.json`：二手房车场景——悬架、电气、外观套件来自三家工坊，证书各自有效但无组合核验；含乱序上报、来源重试（同 `event_id` 重复）与多方重报（同 `fact_key` 不同 `event_id`）。
- `src/`：平台实现。
- `tests/`：契约、存储、投影、评估、撤销、跨地区、权限与交接说明的测试。

## 事件模型

事件由 `event_id` 唯一标识，`aggregate_id` 指向业务对象，`version` 从 1 开始递增，`occurred_at` 保留真实发生时间。来源系统重试时必须沿用原事件标识；多方就同一事实各自上报时共用 `fact_key`。

| 事件类型 | 聚合 | 环节 |
| --- | --- | --- |
| `PART_CERTIFIED` | `certified_part` | 零部件身份与认证 |
| `CERTIFICATE_REVOKED` | `certified_part` | 证书撤销 |
| `PART_INSTALLED` | `vehicle_configuration` | 安装（技师、施工与标定在 payload 中） |
| `PART_REMOVED` | `vehicle_configuration` | 替换、拆除、复原（payload.reason） |
| `ACCIDENT_REPAIR_RECORDED` | `vehicle_configuration` | 事故维修 |
| `CONFIGURATION_INSPECTED` | `inspection_finding` | 检测报告 |
| `REGISTRATION_UPDATED` | `vehicle_configuration` | 登记告知 |
| `INSURANCE_NOTIFIED` | `vehicle_configuration` | 保险告知 |
| `OWNERSHIP_TRANSFERRED` | `ownership_transfer` | 所有权变更 |

车辆事件用 `payload.odometer_km` 锚定不可变里程节点；检测、登记、保险事件用 `covers_part_ids` 标明覆盖部件，缺省视为整车范围。

## 模块

- `src/validator.js`：信封校验，强制事件类型与聚合绑定。
- `src/store.js`：只追加事件存储。同 `event_id` 重试去重、内容不一致报冲突；同 `fact_key` 多方重报去重并记录全部来源；乱序写入后回放结果确定。
- `src/projection.js`：围绕里程节点重建配置演化链（节点只增不改）；零部件注册表给出证书状态（有效/已撤销/已过期/未知）。
- `src/assessment.js`：依据证据输出待核验范围（组合未整体检测、证书失效、标定缺失、登记/保险告知缺失、检测未覆盖），每项都回指依据事件。
- `src/revocation.js`：证书撤销命中具体安装组合——与受影响部件同时在装的部件集合，已先行拆除的不被牵连。
- `src/region.js`：按目的地现行规则评估未来使用状态；评估是只读视图，历史记录不被修改或抹除。
- `src/access.js`：所有权转移即权限切换点——旧车主远程访问随即失效，新车主获得远程查看与交接说明权限，全程可审计。
- `src/handoff.js`：新车主可带去检测或投保的《当前配置说明》：每项结论可回到安装、复检、登记依据；最小披露，无关维修信息不纳入。
- `src/platform.js`：门面，把上述能力串成 `ingest / assess / revocationImpact / evaluateRegion / issueHandoffStatement`。

## 本地检查

运行 `node --test`。
