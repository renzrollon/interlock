namespace Acme.Core.Sensors;

public class Probe
{
    // Probe sits in a child namespace, so Acme.Core is visible without a using.
    private DeviceMetricSource _source = new DeviceMetricSource();
    private string _name = nameof(DeviceMetricSourceFactory);
}
