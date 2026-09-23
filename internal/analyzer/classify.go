package analyzer

import (
	"go/constant"
	"go/types"
	"strings"

	"golang.org/x/tools/go/ssa"
)

func (b *builder) classify(c *ssa.CallCommon) (kind, protocol, reason, label string) {
	kind = "machine"
	label = c.Value.Name()
	path, name := "", label
	if f := c.StaticCallee(); f != nil {
		name = f.Name()
		label = f.RelString(nil)
		if obj := f.Object(); obj != nil && obj.Pkg() != nil {
			path = obj.Pkg().Path()
		}
		if annotation := b.annotations[f.Pos()]; len(annotation) > 0 {
			kind = annotation[0]
			if len(annotation) > 1 {
				protocol = annotation[1]
			}
			return kind, protocol, "Явная аннотация //fabririo:" + strings.Join(annotation, " "), label
		}
	} else if c.Method != nil {
		name = c.Method.Name()
		label = name
		if c.Method.Pkg() != nil {
			path = c.Method.Pkg().Path()
		}
	}
	if builtin, ok := c.Value.(*ssa.Builtin); ok {
		if builtin.Name() == "delete" {
			return "trash", "", "Удаление элемента map через встроенный delete", "delete · удалить"
		}
		if builtin.Name() == "close" {
			return "station", "", "Закрытие канала", "close · закрыть станцию"
		}
		return kind, "", "Встроенная операция Go", builtin.Name()
	}
	match := func(names ...string) bool {
		for _, n := range names {
			if name == n {
				return true
			}
		}
		return false
	}
	if path == "net/http" && match("Do", "Get", "Head", "Post", "PostForm", "RoundTrip", "Write", "WriteHeader", "Redirect", "Error") {
		return "rocket", "http", "Типизированный вызов net/http", label
	}
	if (path == "google.golang.org/grpc" && match("Invoke", "SendMsg", "Send", "NewStream")) || strings.Contains(types.TypeString(c.Signature(), func(p *types.Package) string { return p.Path() }), "google.golang.org/grpc.CallOption") && !match("Dial", "DialContext", "NewClient", "Close", "Recv", "RecvMsg", "Header", "Trailer") {
		return "rocket", "grpc", "gRPC API или сигнатура с grpc.CallOption", label
	}
	if (strings.Contains(path, "gorilla/websocket") || strings.Contains(path, "coder/websocket") || strings.Contains(path, "nhooyr.io/websocket") || strings.Contains(path, "golang.org/x/net/websocket")) && match("Write", "WriteMessage", "WriteJSON", "WriteControl", "NextWriter", "Send") {
		return "rocket", "websocket", "Типизированный вызов WebSocket API", label
	}
	if strings.Contains(path, "pion/webrtc") && match("Send", "SendText", "Write", "WriteRTP", "WriteRTCP", "WriteSample") {
		return "rocket", "webrtc", "Типизированный вызов Pion WebRTC", label
	}
	if (path == "database/sql" || strings.Contains(path, "jackc/pgx") || strings.Contains(path, "jmoiron/sqlx")) && match("Exec", "ExecContext", "CopyFrom", "SendBatch") {
		return "warehouse", "sql", "Вызов записи SQL (Exec может также выполнять DDL)", label
	}
	if (path == "database/sql" || strings.Contains(path, "jackc/pgx") || strings.Contains(path, "jmoiron/sqlx")) && match("Query", "QueryContext", "QueryRow", "QueryRowContext") {
		for _, arg := range c.Args {
			if v, ok := arg.(*ssa.Const); ok && v.Value != nil && v.Value.Kind() == constant.String {
				query := strings.ToUpper(strings.TrimSpace(constant.StringVal(v.Value)))
				words := strings.Fields(query)
				if len(words) > 0 {
					switch words[0] {
					case "INSERT", "UPDATE", "DELETE", "REPLACE", "UPSERT", "CREATE", "ALTER", "DROP", "TRUNCATE":
						return "warehouse", "sql", "SQL-запись с возвращаемым результатом", label
					}
				}
			}
		}
	}
	if strings.Contains(path, "gorm.io/gorm") && match("Create", "Save", "Update", "Updates", "UpdateColumn", "UpdateColumns", "Delete", "Exec") {
		return "warehouse", "gorm", "Типизированный вызов изменения БД через GORM", label
	}
	if strings.Contains(path, "go.mongodb.org/mongo-driver") && match("InsertOne", "InsertMany", "UpdateOne", "UpdateMany", "ReplaceOne", "BulkWrite", "DeleteOne", "DeleteMany") {
		return "warehouse", "mongodb", "Типизированный вызов изменения MongoDB", label
	}
	if (strings.Contains(path, "github.com/redis/go-redis") || strings.Contains(path, "github.com/go-redis/redis")) && match("Set", "SetNX", "MSet", "HSet", "LPush", "RPush", "XAdd", "Del") {
		return "warehouse", "redis", "Типизированный вызов изменения Redis", label
	}
	if c.IsInvoke() {
		reason = "Вызов через интерфейс: конкретная реализация статически не определена"
	} else if c.StaticCallee() == nil {
		reason = "Динамический вызов: цель статически не определена"
	}
	return
}
