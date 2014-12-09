$install = <<SCRIPT
apt-get update
apt-get install -y zookeeperd zookeeper nodejs npm
[ -h /usr/bin/node ] || ln -s /usr/bin/nodejs /usr/bin/node
SCRIPT

Vagrant.configure(2) do |config|
  config.vm.box = "ubuntu/trusty64"
  config.vm.provision "shell", inline: $install
end