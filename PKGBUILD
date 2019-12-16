# Maintainer: Harry ten Berge <htenberge@gmail.com>

pkgname=roon-extension-manager
pkgver=0.11.1
pkgrel=1
arch=(any)
url="https://github.com/TheAppgineer/roon-extension-manager"
license=('Apache')
depends=('nodejs'
         'npm')
options=('!strip')
source=('extension-manager-checkout::git://github.com/RoPieee/roon-extension-manager.git#branch=master')
md5sums=('SKIP')
install=${pkgname}.install



build() {
echo "build"
   cd ${srcdir}/extension-manager-checkout
   rm -rf node_modules
   npm --verbose --production install
}

package() {
echo "package"

   install -d "${pkgdir}/opt/TheAppgineer/extension-manager"
   install -d "${pkgdir}/etc/systemd/system"

   cp -R "${srcdir}/extension-manager-checkout/node_modules"                            "${pkgdir}/opt/TheAppgineer/extension-manager"
   install -m0644 "${srcdir}/extension-manager-checkout/manager.js"                 "${pkgdir}/opt/TheAppgineer/extension-manager/manager.js"
   install -m0644 "${srcdir}/extension-manager-checkout/package.json"                   "${pkgdir}/opt/TheAppgineer/extension-manager/package.json"
   install -m0644 "${srcdir}/extension-manager-checkout/LICENSE"                        "${pkgdir}/opt/TheAppgineer/extension-manager/LICENSE"
   install -m0644 "${srcdir}/extension-manager-checkout/roon-extension-manager.service" "${pkgdir}/etc/systemd/system"

}
