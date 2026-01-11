#!/usr/bin/env node

/**
 * Test script to verify app icon loading functionality
 *
 * This script tests:
 * 1. App discovery finds apps with icon paths
 * 2. Icon paths exist on the filesystem
 * 3. Icon conversion to base64 works
 */

const { AppDiscoveryService } = require('./dist-electron/appDiscoveryService.js');
const fs = require('fs');
const { nativeImage } = require('electron');

async function testIconLoading() {
    console.log('🔍 Testing App Icon Loading...\n');

    try {
        // 1. Get installed apps
        console.log('1️⃣  Discovering installed apps...');
        const apps = await AppDiscoveryService.getInstalledApps();
        console.log(`   ✅ Found ${apps.length} apps\n`);

        // 2. Check apps with icons
        const appsWithIcons = apps.filter(app => app.iconPath);
        const appsWithoutIcons = apps.filter(app => !app.iconPath);

        console.log(`2️⃣  Icon Path Summary:`);
        console.log(`   ✅ Apps with icon paths: ${appsWithIcons.length}`);
        console.log(`   ⚠️  Apps without icon paths: ${appsWithoutIcons.length}\n`);

        // 3. Test first 5 apps with icons
        console.log('3️⃣  Testing icon file existence and conversion:\n');

        const testApps = appsWithIcons.slice(0, 5);
        for (const app of testApps) {
            console.log(`   📱 ${app.name}`);
            console.log(`      Bundle ID: ${app.bundleId}`);
            console.log(`      Icon Path: ${app.iconPath}`);

            // Check if icon file exists
            if (fs.existsSync(app.iconPath)) {
                console.log(`      ✅ Icon file exists`);

                // Try to convert to base64
                try {
                    const image = nativeImage.createFromPath(app.iconPath);
                    if (image.isEmpty()) {
                        console.log(`      ❌ Failed to load icon (empty image)`);
                    } else {
                        const resized = image.resize({ width: 64, height: 64 });
                        const png = resized.toPNG();
                        const base64 = png.toString('base64');
                        const dataUrl = `data:image/png;base64,${base64}`;
                        console.log(`      ✅ Icon converted (${Math.round(dataUrl.length / 1024)}KB)`);
                    }
                } catch (error) {
                    console.log(`      ❌ Error converting icon: ${error.message}`);
                }
            } else {
                console.log(`      ❌ Icon file does not exist!`);
            }
            console.log('');
        }

        // 4. Sample apps without icons
        if (appsWithoutIcons.length > 0) {
            console.log('4️⃣  Sample apps without icon paths:\n');
            appsWithoutIcons.slice(0, 3).forEach(app => {
                console.log(`   📱 ${app.name} (${app.bundleId})`);
                console.log(`      Path: ${app.path}\n`);
            });
        }

        console.log('\n✅ Test completed successfully!');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }
}

// Note: This requires Electron to be available
console.log('Note: This script requires Electron to be built first.');
console.log('Run: npm run build\n');

testIconLoading();
