import { execSync } from "child_process"
import { existsSync } from "fs"
import { join, dirname } from "path"

/**
 * SAIA Plugin for OpenCode
 * 
 * Automatically updates and copies SAIA configuration when OpenCode starts.
 */

export default async ({ directory }: { directory?: string }) => {
  console.log("[SAIA Plugin] Updating SAIA configuration...")
  
  // Get the plugin directory from the current file location
  const pluginDir = dirname(__filename)
  const generateScript = join(pluginDir, "generate-saia-config.sh")
  const copyScript = join(pluginDir, "copy-saia-config.sh")
  
  // Check if scripts exist
  if (!existsSync(generateScript)) {
    console.error("[SAIA Plugin] ✗ Generate script not found:", generateScript)
    console.error("[SAIA Plugin] → Verify plugin installation: ~/.config/opencode/plugins/saia/")
    return {}
  }

  if (!existsSync(copyScript)) {
    console.error("[SAIA Plugin] ✗ Copy script not found:", copyScript)
    console.error("[SAIA Plugin] → Verify plugin installation: ~/.config/opencode/plugins/saia/")
    return {}
  }
  
  try {
    console.error("[SAIA Plugin] → Running generate script...")
    execSync(generateScript, {
      cwd: pluginDir,
      stdio: "inherit"
    })
  } catch (error) {
    console.error("[SAIA Plugin] ✗ Failed to generate:", (error as Error).message)
    console.error("[SAIA Plugin] → Check SAIA_API_KEY and network access")
    return {}
  }

  try {
    console.error("[SAIA Plugin] → Copying configuration...")
    execSync(copyScript, {
      cwd: directory || process.cwd(),
      stdio: "inherit"
    })
    console.error("[SAIA Plugin] ✓ Configuration updated")
  } catch (error) {
    console.error("[SAIA Plugin] ✗ Failed to copy:", (error as Error).message)
    console.error("[SAIA Plugin] → Check directory permissions")
    return {}
  }

  console.error("[SAIA Plugin] ✓ SAIA plugin initialized successfully")
  
  return {}
}
