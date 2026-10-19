# Plugins

Idea for this, each plugin can be run in isolation and communicate with other exposed plugins. What this will look like is that everything will run in a (web) worker. I'm thinking something like this:

```typescript
import { plugin } from "plugins"
// these interfaces are zod schemas
import { InterfaceA, InterfaceB, InterfaceC } from "some-packages"

// says these require these interfaces from the plugin
const interfaceA = plugin.require(InterfaceA)
const interfaceB = plugin.require(InterfaceB)

// zod interface which we expose
@plugin.Component(InterfaceC)
class InterfaceCImpl {
}
```

Communication between the components and the plugins will be through web worker `postMessage` and `worker.onmessage` and ofc all this will happen behind the scenes.
