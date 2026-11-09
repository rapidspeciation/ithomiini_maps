// Loaded (NODE_OPTIONS) into the node processes a test starts: the guard of test/no-ai-core.mjs, reporting to the test.
import { installNoAiGuard } from './no-ai-core.mjs'

installNoAiGuard({ owner: !process.env.NOAI_GUARD_PARENT })
