$install = <<SCRIPT
apt-get update
apt-get install -y zookeeperd zookeeper nodejs npm
SCRIPT

Vagrant.configure(2) do |config|
  config.vm.box = "hashicorp/precise64"
  config.vm.provision "shell", inline: $install
end